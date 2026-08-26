const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "products.json");
const produtos = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));

function listar() {
  return produtos;
}

function buscarPorSlug(slug) {
  return produtos.find((p) => p.slug === slug) || null;
}

function buscarPorId(id) {
  return produtos.find((p) => p.id === id) || null;
}

function buscarRelacionados(produto) {
  const slugsConfigurados = Array.isArray(produto.relacionados)
    ? produto.relacionados
    : [];

  const relacionadosConfigurados = slugsConfigurados
    .map(buscarPorSlug)
    .filter((item) => item && item.id !== produto.id);

  const idsIncluidos = new Set(relacionadosConfigurados.map((item) => item.id));
  const complementares = produtos.filter(
    (item) => item.id !== produto.id && !idsIncluidos.has(item.id)
  );

  return [...relacionadosConfigurados, ...complementares];
}

module.exports = { listar, buscarPorSlug, buscarPorId, buscarRelacionados };
