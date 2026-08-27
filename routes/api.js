const express = require("express");
const router = express.Router();
const produtos = require("../lib/products");
const orderStore = require("../lib/orderStore");
const { getPixProvider } = require("../lib/pixProvider");

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
    const { cliente, endereco, itens } = req.body;

    if (!cliente?.nome || !cliente?.email || !cliente?.telefone) {
      return res.status(400).json({ erro: "Dados do cliente incompletos." });
    }
    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ erro: "Carrinho vazio." });
    }

    const itensValidados = [];
    let total = 0;

    for (const item of itens) {
      const produto = produtos.buscarPorId(item.id);
      if (!produto) {
        return res.status(400).json({ erro: `Produto ${item.id} não encontrado.` });
      }
      const quantidade = Math.max(1, Math.min(parseInt(item.quantidade, 10) || 1, produto.estoque));
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
    };

    orderStore.create(pedido);
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
    console.error("Erro ao criar pedido:", err);
    res.status(500).json({ erro: "Não foi possível gerar o pagamento Pix. Tente novamente." });
  }
});

router.get("/pedidos/:id/status", async (req, res) => {
  const pedido = orderStore.findById(req.params.id);
  if (!pedido) return res.status(404).json({ erro: "Pedido não encontrado." });

  if (pedido.status === "pendente") {
    try {
      const provider = getPixProvider();
      if (typeof provider.getStatus === "function") {
        const statusRemoto = await provider.getStatus(pedido.pagamento.providerChargeId);
        if (statusRemoto && statusRemoto !== pedido.status) {
          orderStore.update(pedido.id, { status: statusRemoto });
          return res.json({ status: statusRemoto });
        }
      }
    } catch (err) {
      console.error("Erro ao consultar status remoto do Pix:", err);
    }
  }

  res.json({ status: pedido.status });
});

// Endpoint de apoio para ambiente de teste (MockPixProvider): confirma o
// pagamento manualmente, simulando o webhook que um gateway real enviaria.
router.post("/pedidos/:id/simular-pagamento", (req, res) => {
  const pedido = orderStore.findById(req.params.id);
  if (!pedido) return res.status(404).json({ erro: "Pedido não encontrado." });
  if (pedido.pagamento.ambiente !== "teste") {
    return res.status(403).json({ erro: "Disponível apenas no ambiente de teste." });
  }
  const atualizado = orderStore.update(pedido.id, { status: "pago" });
  res.json({ status: atualizado.status });
});

// Ponto de entrada para o webhook da ZuckPay (urlnoty). O payload vem
// como { event, platform, transaction: { external_id_client, status, ... } }.
router.post("/webhooks/pix", express.json(), (req, res) => {
  const payload = req.body || {};
  console.log("Webhook Pix recebido:", JSON.stringify(payload));

  const transacao = payload.transaction || payload;
  const pedidoId = transacao.external_id_client || transacao.external_id;
  const status = transacao.status;

  if (pedidoId && status === "PAID") {
    const pedido = orderStore.findById(pedidoId);
    if (pedido && pedido.status !== "pago") {
      orderStore.update(pedido.id, { status: "pago" });
    }
  }

  res.sendStatus(200);
});

module.exports = router;
