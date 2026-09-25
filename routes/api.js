const express = require("express");
const router = express.Router();
const produtos = require("../lib/products");
const orderStore = require("../lib/orderStore");
const { getPixProvider } = require("../lib/pixProvider");
const { normalizeAttribution } = require("../lib/attribution");
const { processarPedidoAprovado } = require("../lib/rastreioExpress");
const { createReference, readReference } = require("../lib/pixReference");

function gerarIdPedido() {
  const carimbo = Date.now().toString(36).toUpperCase();
  const aleatorio = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CM-${carimbo}${aleatorio}`;
}

router.post("/carrinho/validar", (req, res) => {
  const itensRecebidos = Array.isArray(req.body?.itens) ? req.body.itens : [];
  const itens = itensRecebidos
    .map((item) => {
      const produto = produtos.buscarPorId(item.id);
      if (!produto || produto.estoque <= 0) return null;

      return {
        id: produto.id,
        nome: produto.nome,
        imagem: produto.imagens[0],
        precoPix: Number(produto.precoPix),
        quantidade: Math.max(
          1,
          Math.min(parseInt(item.quantidade, 10) || 1, produto.estoque)
        ),
      };
    })
    .filter(Boolean);

  res.json({ itens });
});

router.post("/pedidos", async (req, res) => {
  try {
    const { cliente, endereco, itens, clickId } = req.body;
    const attribution = normalizeAttribution(req.body.attribution, clickId);

    if (!cliente?.nome || !cliente?.email || !cliente?.telefone) {
      return res.status(400).json({ erro: "Dados do cliente incompletos." });
    }
    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ erro: "Carrinho vazio." });
    }

    const itensValidados = [];
    const temPrincipal = itens.some((item) => {
      const produto = produtos.buscarPorId(item.id);
      return produto && !produto.orderBump && produto.estoque > 0;
    });
    if (!temPrincipal) {
      return res.status(400).json({ erro: "Adicione um produto principal para finalizar o pedido." });
    }
    const bumpsIncluidos = new Set();
    let total = 0;

    for (const item of itens) {
      const produto = produtos.buscarPorId(item.id);
      if (!produto) {
        return res.status(400).json({ erro: `Produto ${item.id} não encontrado.` });
      }
      if (produto.orderBump) {
        if (produto.estoque <= 0 || bumpsIncluidos.has(produto.id)) {
          return res.status(400).json({ erro: "Oferta indisponível ou repetida no pedido." });
        }
        bumpsIncluidos.add(produto.id);
      }
      const quantidade = produto.orderBump ? 1 : Math.max(1, Math.min(parseInt(item.quantidade, 10) || 1, produto.estoque));
      const subtotal = produto.precoPix * quantidade;
      total += subtotal;
      itensValidados.push({
        id: produto.id,
        nome: produto.nome,
        imagem: produto.imagens[0],
        precoUnitario: produto.precoPix,
        quantidade,
        subtotal,
      });
    }

    const id = gerarIdPedido();
    const provider = getPixProvider();
    const pagamento = await provider.createCharge({
      orderId: id,
      valor: Number(total.toFixed(2)),
      descricao: `Pedido ${id} - Casa Marisol`,
      cliente,
      endereco,
      clickId: attribution.click_id || null,
      attribution,
    });

    const pedido = {
      id,
      criadoEm: new Date().toISOString(),
      cliente,
      endereco,
      itens: itensValidados,
      total: Number(total.toFixed(2)),
      status: "pendente",
      pagamento,
      clickId: attribution.click_id || null,
      attribution,
    };
    pagamento.provider ||= (process.env.PIX_PROVIDER || "mock").toLowerCase();

    try {
      // Cache local opcional (não disponível em hospedagens serverless
      // como a Vercel, cujo sistema de arquivos é somente leitura). O
      // status do pagamento sempre pode ser reconsultado na ZuckPay
      // pelo external_id_client, então isso não é essencial.
      orderStore.create(pedido);
    } catch (err) {
      console.warn("Aviso: não foi possível salvar o pedido localmente:", err.message);
    }

    res.status(201).json({
      id: pedido.id,
      status: pedido.status,
      total: pedido.total,
      referenciaPix: pagamento.provider === "tiggerpay"
        ? createReference(pedido.id, pagamento.providerChargeId) : undefined,
      pagamento: {
        tipo: "pix",
        copiaECola: pagamento.copiaECola,
        qrCodeDataUrl: pagamento.qrCodeDataUrl,
        expiraEm: pagamento.expiraEm,
        ambiente: pagamento.ambiente,
      },
    });
  } catch (err) {
    console.error("Erro ao criar pedido:", err);
    res.status(500).json({
      erro: "Não foi possível gerar o pagamento Pix. Tente novamente.",
      detalhe: err.message,
    });
  }
});

router.get("/pedidos/:id/status", async (req, res) => {
  let pedido = null;
  try {
    pedido = orderStore.findById(req.params.id);
  } catch (_) {
    // sem cache local disponível (ex.: Vercel) — segue direto pra ZuckPay.
  }

  try {
    const referenceId = readReference(req.query.referencia, req.params.id);
    if (req.query.referencia && !referenceId) {
      return res.status(400).json({ erro: "Referencia de pagamento invalida." });
    }
    const provider = getPixProvider((referenceId ? "tiggerpay" : pedido?.pagamento?.provider) ||
      (pedido ? (pedido.pagamento.ambiente === "teste" ? "mock" : "zuckpay") : undefined));
    if (typeof provider.getStatus === "function") {
      const statusRemoto = await provider.getStatus({
        transactionId: referenceId || pedido?.pagamento?.providerChargeId,
        externalId: req.params.id,
      });
      if (statusRemoto) {
        if (pedido) {
          try {
            if (pedido.status !== statusRemoto) {
              orderStore.update(pedido.id, { status: statusRemoto });
            }
            // Chamado em toda consulta com status "pago" (não só na primeira
            // transição): confirmação real vinda da própria ZuckPay. A
            // idempotência/retry fica a cargo de processarPedidoAprovado, que
            // relê o pedido e reprocessa com segurança uma tentativa anterior
            // que tenha falhado (ex.: Rastreio Express fora do ar).
            if (statusRemoto === "pago") {
              // Dracofy receives payment confirmation directly from ZuckPay.
              await processarPedidoAprovado(pedido);
            }
          } catch (err) {
            console.warn(`Falha ao processar confirmação do pedido ${pedido.id}:`, err.message);
          }
        } else if (statusRemoto === "pago") {
          console.warn(`Pedido ${req.params.id} pago sem registro local; atribuição indisponível.`);
        }
        return res.json({ status: statusRemoto });
      }
    }
  } catch (err) {
    console.error("Erro ao consultar status remoto do Pix:", err);
  }

  if (!pedido) return res.status(404).json({ erro: "Pedido não encontrado." });
  res.json({ status: pedido.status });
});

// Endpoint de apoio para ambiente de teste (MockPixProvider): confirma o
// pagamento manualmente, simulando o webhook que um gateway real enviaria.
router.post("/pedidos/:id/simular-pagamento", async (req, res) => {
  const pedido = orderStore.findById(req.params.id);
  if (!pedido) return res.status(404).json({ erro: "Pedido não encontrado." });
  if (pedido.pagamento.ambiente !== "teste") {
    return res.status(403).json({ erro: "Disponível apenas no ambiente de teste." });
  }
  const atualizado = orderStore.update(pedido.id, { status: "pago" });
  // Simulated payments must not send advertising conversions.
  // Simulação de pagamento (ambiente de teste) não é uma confirmação real:
  // não deve gerar rastreio no Rastreio Express (regra 1 da integração).
  res.json({ status: atualizado.status });
});

// Ponto de entrada para o webhook da ZuckPay (urlnoty). O payload vem
// como { event, platform, transaction: { external_id_client, status, ... } }.
router.post("/webhooks/pix", express.json(), async (req, res) => {
  const payload = req.body || {};
  if (payload.txid && payload.evento === "paid") {
    try {
      const pedido = orderStore.readAll().find((order) =>
        order.pagamento?.provider === "tiggerpay" && order.pagamento.providerChargeId === payload.txid);
      if (!pedido) return res.sendStatus(200);
      const provider = getPixProvider("tiggerpay");
      if (await provider.verifyPaidSale(payload.txid, pedido.total)) {
        orderStore.update(pedido.id, { status: "pago" });
        await processarPedidoAprovado(pedido);
      }
      return res.sendStatus(200);
    } catch (err) {
      console.warn("Falha ao verificar webhook TiggerPay:", err.message);
      return res.sendStatus(503);
    }
  }

  const transacao = payload.transaction || payload;
  const pedidoId = transacao.external_id_client || transacao.external_id;
  const status = transacao.status;

  if (pedidoId && status === "PAID") {
    // Best-effort: sem cache local disponível (ex.: Vercel), a confirmação
    // real acontece via GET /api/pedidos/:id/status, que consulta a ZuckPay
    // diretamente pelo external_id_client.
    try {
      const pedido = orderStore.findById(pedidoId);
      if (pedido && (!pedido.pagamento.provider || pedido.pagamento.provider === "zuckpay") &&
          pedido.pagamento.ambiente !== "teste" &&
          await getPixProvider("zuckpay").getStatus({ transactionId: pedido.pagamento.providerChargeId, externalId: pedido.id }) === "pago") {
        if (pedido.status !== "pago") {
          orderStore.update(pedido.id, { status: "pago" });
        }
        // Chamado em toda notificação "PAID" (inclusive webhook duplicado):
        // confirmação real vinda do webhook oficial da ZuckPay. A
        // idempotência/retry fica a cargo de processarPedidoAprovado, que
        // relê o pedido e reprocessa com segurança uma tentativa anterior
        // que tenha falhado (ex.: Rastreio Express fora do ar).
        // Dracofy receives payment confirmation directly from ZuckPay.
        await processarPedidoAprovado(pedido);
      } else {
        console.warn(`Webhook Pix: pedido ${pedidoId} não encontrado; atribuição indisponível.`);
      }
    } catch (err) {
      console.warn(`Falha ao processar webhook do pedido ${pedidoId}:`, err.message);
    }
  }

  res.sendStatus(200);
});

module.exports = router;
