const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "products.json");
const DEPOIMENTOS_PATH = path.join(__dirname, "..", "data", "depoimentos.json");
const produtos = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
const depoimentos = JSON.parse(fs.readFileSync(DEPOIMENTOS_PATH, "utf8"));

// Produtos com resumo de avaliações mas sem depoimentos próprios usam os
// depoimentos padrão da loja (evita repetir o mesmo array grande em cada
// produto do products.json).
produtos.forEach((produto) => {
  if (produto.avaliacoesResumo && !produto.avaliacoesLista) {
    produto.avaliacoesLista = depoimentos;
  }
});

function listar() {
  return produtos;
}

function buscarPorSlug(slug) {
  return produtos.find((p) => p.slug === slug) || null;
}

function buscarPorId(id) {
  const [idBase, idExtra] = String(id).split("::");
  const produto = produtos.find((p) => p.id === idBase);
  if (!produto) return null;
  if (!idExtra) return produto;

  if (Array.isArray(produto.variacoes)) {
    const variacao = produto.variacoes.find((v) => v.id === idExtra);
    if (variacao) {
      return {
        ...produto,
        id,
        nome: `${produto.nome} - ${variacao.capacidade}`,
        precoDe: variacao.precoDe ?? produto.precoDe,
        precoPix: variacao.precoPix,
      };
    }
  }

  // Opções que não alteram o preço (ex.: voltagem, cor): só identificam a
  // escolha do cliente para o pedido, sem mexer em precoPix/precoDe.
  if (Array.isArray(produto.opcoes)) {
    for (const opcao of produto.opcoes) {
      const escolha = (opcao.escolhas || []).find((e) => e.id === idExtra);
      if (escolha) {
        return { ...produto, id, nome: `${produto.nome} - ${escolha.label}` };
      }
    }
  }

  return null;
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
