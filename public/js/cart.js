(function () {
  const CHAVE_CARRINHO = "cm_carrinho";

  function obterCarrinho() {
    try {
      const dados = localStorage.getItem(CHAVE_CARRINHO);
      return dados ? JSON.parse(dados) : [];
    } catch (e) {
      return [];
    }
  }

  function salvarCarrinho(itens) {
    localStorage.setItem(CHAVE_CARRINHO, JSON.stringify(itens));
    atualizarContagem();
  }

  function adicionarItem(produto, quantidade) {
    const itens = obterCarrinho();
    const existente = itens.find((i) => i.id === produto.id);
    if (existente) {
      existente.quantidade += quantidade;
      existente.nome = produto.nome;
      existente.imagem = produto.imagem;
      existente.precoPix = Number(produto.precoPix);
    } else {
      itens.push({
        id: produto.id,
        nome: produto.nome,
        imagem: produto.imagem,
        precoPix: produto.precoPix,
        quantidade,
      });
    }
    salvarCarrinho(itens);
  }

  async function sincronizarCarrinho() {
    const itens = obterCarrinho();
    if (itens.length === 0) return itens;

    try {
      const resposta = await fetch("/api/carrinho/validar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itens }),
      });
      if (!resposta.ok) throw new Error("Falha ao atualizar o carrinho.");

      const dados = await resposta.json();
      salvarCarrinho(dados.itens);
      return dados.itens;
    } catch (erro) {
      console.error("Não foi possível sincronizar o carrinho:", erro);
      return itens;
    }
  }

  function removerItem(id) {
    salvarCarrinho(obterCarrinho().filter((i) => i.id !== id));
  }

  function atualizarQuantidade(id, quantidade) {
    const itens = obterCarrinho();
    const item = itens.find((i) => i.id === id);
    if (!item) return;
    item.quantidade = Math.max(1, quantidade);
    salvarCarrinho(itens);
  }

  function limparCarrinho() {
    salvarCarrinho([]);
  }

  function totalItens(itens) {
    return (itens || obterCarrinho()).reduce((soma, i) => soma + i.quantidade, 0);
  }

  function totalCarrinho(itens) {
    const total = (itens || obterCarrinho()).reduce(
      (soma, i) => soma + i.quantidade * Number(i.precoPix),
      0
    );
    return Number(total.toFixed(2));
  }

  function atualizarContagem() {
    const el = document.getElementById("contagem-carrinho");
    if (el) el.textContent = totalItens();
  }

  function mostrarToast(mensagem) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = mensagem;
    toast.classList.add("mostrar");
    clearTimeout(window.__toastTimeout);
    window.__toastTimeout = setTimeout(() => toast.classList.remove("mostrar"), 2800);
  }

  function formatarMoeda(valor) {
    return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  window.CasaMarisolCarrinho = {
    obterCarrinho,
    salvarCarrinho,
    adicionarItem,
    sincronizarCarrinho,
    removerItem,
    atualizarQuantidade,
    limparCarrinho,
    totalItens,
    totalCarrinho,
    mostrarToast,
    formatarMoeda,
  };

  document.addEventListener("DOMContentLoaded", () => {
    atualizarContagem();

    const btnFavoritos = document.getElementById("btn-favoritos");
    if (btnFavoritos) {
      btnFavoritos.addEventListener("click", () => {
        mostrarToast("Em breve você poderá salvar seus produtos favoritos aqui.");
      });
    }
  });
})();
