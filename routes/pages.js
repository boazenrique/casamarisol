const express = require("express");
const router = express.Router();
const produtos = require("../lib/products");
const orderStore = require("../lib/orderStore");

const LOJA = {
  nome: "Casa Marisol",
  tagline: "Tudo para sua casa, com preço que cabe no bolso!",
  freteGratisAcima: 399,
};

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
  res.render("checkout", { loja: LOJA });
});

router.get("/pagamento/:id", (req, res) => {
  const pedido = orderStore.findById(req.params.id);
  if (!pedido) return res.status(404).render("404", { loja: LOJA });
  res.render("pagamento", { loja: LOJA, pedido });
});

module.exports = router;
