const express = require("express");
const router = express.Router();
const produtos = require("../lib/products");
const orderStore = require("../lib/orderStore");

const LOJA = {
  nome: "Casa Marisol",
  tagline: "Tudo para sua casa, com preço que cabe no bolso!",
  freteGratisAcima: 399,
};

router.get("/favicon.ico", (req, res) => res.redirect(302, "/images/logo.png"));

router.get("/", (req, res) => {
  res.render("index", { loja: LOJA, produtos: produtos.listar() });
});

router.get("/produto/:slug", (req, res) => {
  const produto = produtos.buscarPorSlug(req.params.slug);
  if (!produto) return res.status(404).render("404", { loja: LOJA });
  const relacionados = produtos.buscarRelacionados(produto);
  res.render("produto", { loja: LOJA, produto, relacionados });
});

router.get("/carrinho", (req, res) => {
  res.render("carrinho", { loja: LOJA });
});

router.get("/checkout", (req, res) => {
  res.render("checkout", { loja: LOJA, orderBumps: produtos.buscarOrderBump() });
});

router.get("/pagamento/:id", async (req, res, next) => {
  try {
    const pedido = await orderStore.findById(req.params.id);
    if (!pedido) return res.status(404).render("404", { loja: LOJA });
    res.render("pagamento", { loja: LOJA, pedido });
  } catch (_) {
    res.status(503).send("Nao foi possivel consultar o pedido agora. Tente novamente em instantes.");
  }
});

router.get("/pedido/:id/confirmado", async (req, res) => {
  try {
    const pedido = await orderStore.findById(req.params.id);
    if (!pedido) return res.status(404).render("404", { loja: LOJA });
    // So mostra a pagina de confirmacao com pagamento ja aprovado; um link
    // visitado antes disso volta para a tela de pagamento (que redireciona
    // pra ca sozinha assim que o Pix for confirmado).
    if (pedido.status !== "pago") return res.redirect(`/pagamento/${encodeURIComponent(pedido.id)}`);
    res.render("confirmado", { loja: LOJA, pedido });
  } catch (_) {
    res.status(503).send("Nao foi possivel consultar o pedido agora. Tente novamente em instantes.");
  }
});

module.exports = router;
