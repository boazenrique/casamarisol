(function () {
  const carrinho = window.CasaMarisolCarrinho;

  function renderizar() {
    const itens = carrinho.obterCarrinho();
    const lista = document.getElementById("lista-carrinho");
    const vazio = document.getElementById("carrinho-vazio");
    const resumo = document.getElementById("resumo");

    if (itens.length === 0) {
      lista.innerHTML = "";
      vazio.style.display = "block";
      resumo.style.display = "none";
      return;
    }

    vazio.style.display = "none";
    resumo.style.display = "flex";

    lista.innerHTML = itens
      .map(
        (item) => `
        <div class="item-carrinho" data-id="${item.id}">
          <img src="${item.imagem}" alt="${item.nome}" />
          <div>
            <div class="nome-item">${item.nome}</div>
            <button type="button" class="remover" data-acao="remover">Remover</button>
          </div>
          <div class="stepper">
            <button type="button" data-acao="menos">−</button>
            <input type="number" min="1" value="${item.quantidade}" data-acao="qtd" />
            <button type="button" data-acao="mais">+</button>
          </div>
          <div class="preco-item">${carrinho.formatarMoeda(item.quantidade * item.precoPix)}</div>
        </div>`
      )
      .join("");

    document.getElementById("total-carrinho").textContent = carrinho.formatarMoeda(carrinho.totalCarrinho(itens));

    lista.querySelectorAll("[data-acao]").forEach((el) => {
      const linha = el.closest(".item-carrinho");
      const id = linha.dataset.id;
      const item = itens.find((i) => i.id === id);

      if (el.dataset.acao === "remover") {
        el.addEventListener("click", () => {
          carrinho.removerItem(id);
          renderizar();
        });
      }
      if (el.dataset.acao === "menos") {
        el.addEventListener("click", () => {
          carrinho.atualizarQuantidade(id, item.quantidade - 1);
          renderizar();
        });
      }
      if (el.dataset.acao === "mais") {
        el.addEventListener("click", () => {
          carrinho.atualizarQuantidade(id, item.quantidade + 1);
          renderizar();
        });
      }
      if (el.dataset.acao === "qtd") {
        el.addEventListener("change", () => {
          carrinho.atualizarQuantidade(id, parseInt(el.value, 10) || 1);
          renderizar();
        });
      }
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    await carrinho.sincronizarCarrinho();
    renderizar();
  });
})();
