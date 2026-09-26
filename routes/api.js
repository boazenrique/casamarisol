const express = require("express");
const router = express.Router();
const { randomUUID } = require("node:crypto");
const produtos = require("../lib/products");
const orderStore = require("../lib/orderStore");
const { getPixProvider, FrendzPixProvider } = require("../lib/pixProvider");
const { normalizeAttribution } = require("../lib/attribution");
const { processarPedidoAprovado } = require("../lib/rastreioExpress");
const { notificarDracofy } = require("../lib/dracofy");

function providerDoPedido(pedido) {
  if (!pedido) return undefined;
  return pedido.pagamento?.provider || (pedido.pagamento?.ambiente === "teste" ? "mock" : "zuckpay");
}

async function processarConfirmacao(pedido) {
  if (pedido.status !== "pago" || pedido.testeIntegracao) return;
  await orderStore.withOrderLock(pedido.id, async () => {
    const current = await orderStore.findById(pedido.id);
    if (!current || current.status !== "pago" || current.testeIntegracao) return;
    if (current.pagamento?.provider === "frendz") await notificarDracofy(current);
    await processarPedidoAprovado(current);
  });
}

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
  let etapa = "validacao";
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
    if (provider instanceof FrendzPixProvider) {
      // A consulta Frendz exige o hash retornado ao criar a transacao.
      // Confere o Postgres na Vercel ou o disco no ambiente local.
      etapa = "armazenamento";
      await orderStore.assertWritable();
    }
    etapa = "gateway";
    const pagamento = await provider.createCharge({
      orderId: id,
      valor: Number(total.toFixed(2)),
      descricao: `Pedido ${id} - Casa Marisol`,
      cliente,
      endereco,
      itens: itensValidados,
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

    try {
      etapa = "salvar_pedido";
      // Frendz exige persistir o hash remoto para consultas posteriores.
      // O fallback sem disco por external_id_client e exclusivo da ZuckPay.
      await orderStore.create(pedido);
    } catch (err) {
      if (pagamento.provider === "frendz") throw new Error("Falha ao salvar o pedido Frendz. Consulte a transacao no painel antes de repetir.");
      console.warn("Aviso: não foi possível salvar o pedido localmente:", err.message);
    }

    res.status(201).json({
      id: pedido.id,
      status: pedido.status,
      total: pedido.total,
      pagamento: {
        tipo: "pix",
        copiaECola: pagamento.copiaECola,
        qrCodeDataUrl: pagamento.qrCodeDataUrl,
        expiraEm: pagamento.expiraEm,
        ambiente: pagamento.ambiente,
      },
    });
  } catch (err) {
    const referencia = randomUUID();
    const codigo = err.code === "ORDER_STORAGE_NOT_CONFIGURED" ? err.code :
      etapa === "armazenamento" || etapa === "salvar_pedido" ? "ORDER_STORAGE_ERROR" :
      ["FRENDZ_NOT_CONFIGURED", "FRENDZ_NETWORK_ERROR", "FRENDZ_HTTP_ERROR"].includes(err.code) ? err.code : "ORDER_CREATE_ERROR";
    console.error("Falha ao criar pedido", { referencia, etapa, codigo, providerStatus: err.providerStatus });
    const status = codigo.startsWith("ORDER_STORAGE") || codigo === "FRENDZ_NOT_CONFIGURED" ? 503 :
      codigo.startsWith("FRENDZ_") ? 502 : 500;
    res.status(status).json({
      erro: `Não foi possível gerar o pagamento Pix. Referência: ${referencia}`,
      codigo, referencia,
    });
  }
});

router.get("/pedidos/:id/status", async (req, res) => {
  let pedido = null;
  try {
    pedido = await orderStore.findById(req.params.id);
  } catch (_) {
    return res.status(503).json({ erro: "Não foi possível consultar o pedido agora.", codigo: "ORDER_STORAGE_ERROR" });
  }

  try {
    const provider = getPixProvider(providerDoPedido(pedido));
    if (typeof provider.getStatus === "function") {
      const statusRemoto = await provider.getStatus({
        transactionId: pedido?.pagamento?.providerChargeId,
        externalId: req.params.id,
        valor: pedido?.total,
      });
      if (statusRemoto) {
        if (pedido) {
          try {
            if (pedido.status !== statusRemoto) {
              await orderStore.update(pedido.id, { status: statusRemoto });
            }
            // Chamado em toda consulta com status "pago" (não só na primeira
            // transição): confirmação real vinda da API do provedor. A
            // idempotência/retry fica a cargo de processarPedidoAprovado, que
            // relê o pedido e reprocessa com segurança uma tentativa anterior
            // que tenha falhado (ex.: Rastreio Express fora do ar).
            if (statusRemoto === "pago") {
              // Frendz envia conversao pelo backend; ZuckPay usa callback direto.
              await processarConfirmacao({ ...pedido, status: "pago" });
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
  try {
  const pedido = await orderStore.findById(req.params.id);
  if (!pedido) return res.status(404).json({ erro: "Pedido não encontrado." });
  if (pedido.pagamento.ambiente !== "teste") {
    return res.status(403).json({ erro: "Disponível apenas no ambiente de teste." });
  }
  const atualizado = await orderStore.update(pedido.id, { status: "pago" });
  // Simulated payments must not send advertising conversions.
  // Simulação de pagamento (ambiente de teste) não é uma confirmação real:
  // não deve gerar rastreio no Rastreio Express (regra 1 da integração).
  res.json({ status: atualizado.status });
  } catch (_) {
    res.status(503).json({ erro: "Não foi possível consultar o pedido agora.", codigo: "ORDER_STORAGE_ERROR" });
  }
});

// Ponto de entrada para o webhook da ZuckPay (urlnoty). O payload vem
// como { event, platform, transaction: { external_id_client, status, ... } }.
router.post("/webhooks/pix", express.json(), async (req, res) => {
  const payload = req.body || {};

  const transacao = payload.transaction || payload;
  const pedidoId = transacao.external_id_client || transacao.external_id;
  const status = transacao.status;

  if (pedidoId && status === "PAID") {
    // Best-effort: sem cache local disponível (ex.: Vercel), a confirmação
    // real acontece via GET /api/pedidos/:id/status, que consulta a ZuckPay
    // diretamente pelo external_id_client.
    try {
      const pedido = await orderStore.findById(pedidoId);
      if (pedido && providerDoPedido(pedido) === "zuckpay") {
        const statusConfirmado = await getPixProvider("zuckpay").getStatus({
          transactionId: pedido.pagamento?.providerChargeId, externalId: pedido.id,
        });
        if (statusConfirmado !== "pago") return res.sendStatus(200);
        if (pedido.status !== "pago") {
          await orderStore.update(pedido.id, { status: "pago" });
        }
        // Chamado em toda notificação "PAID" (inclusive webhook duplicado):
        // confirmação real vinda do webhook oficial da ZuckPay. A
        // idempotência/retry fica a cargo de processarPedidoAprovado, que
        // relê o pedido e reprocessa com segurança uma tentativa anterior
        // que tenha falhado (ex.: Rastreio Express fora do ar).
        // Dracofy receives payment confirmation directly from ZuckPay.
        await processarConfirmacao({ ...pedido, status: "pago" });
      } else {
        console.warn(`Webhook Pix: pedido ${pedidoId} não encontrado; atribuição indisponível.`);
      }
    } catch (err) {
      console.warn(`Falha ao processar webhook do pedido ${pedidoId}:`, err.message);
    }
  }

  res.sendStatus(200);
});

// O postback e apenas um aviso: o status, valor e identificador sao conferidos
// na API autenticada antes de qualquer confirmacao ou envio de conversao.
router.post("/webhooks/frendz", async (req, res) => {
  if (typeof req.query.pedido !== "string") return res.sendStatus(400);
  try {
    const pedido = await orderStore.findById(req.query.pedido);
    // Solicita nova entrega se a criacao do pedido ainda estiver em andamento.
    if (!pedido) return res.sendStatus(503);
    if (providerDoPedido(pedido) !== "frendz") return res.sendStatus(400);
    const status = await getPixProvider("frendz").getStatus({
      transactionId: pedido.pagamento.providerChargeId, valor: pedido.total,
    });
    if (status) {
      if (pedido.status !== status) await orderStore.update(pedido.id, { status });
      if (status === "pago") await processarConfirmacao({ ...pedido, status });
    }
    return res.sendStatus(200);
  } catch (_) {
    console.warn("Frendz: nao foi possivel verificar a notificacao de pagamento.");
    return res.sendStatus(503);
  }
});

module.exports = router;
