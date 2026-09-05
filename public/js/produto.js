(function () {
  const produto = window.__PRODUTO__;
  const loja = window.__LOJA__;
  const carrinho = window.CasaMarisolCarrinho;

  /* ---------- Galeria ---------- */
  const imagemPrincipal = document.getElementById("imagem-principal");
  const videoPrincipal = document.getElementById("video-principal");
  const miniaturas = Array.from(document.querySelectorAll("#miniaturas button"));
  let indiceAtual = 0;

  function mostrarMidia(indice) {
    indiceAtual = (indice + miniaturas.length) % miniaturas.length;
    const botao = miniaturas[indiceAtual];
    const exibirVideo = botao.dataset.tipo === "video";

    if (exibirVideo && videoPrincipal) {
      imagemPrincipal.hidden = true;
      videoPrincipal.hidden = false;
      if (videoPrincipal.src !== new URL(botao.dataset.src, window.location.origin).href) {
        videoPrincipal.src = botao.dataset.src;
      }
    } else {
      if (videoPrincipal) {
        videoPrincipal.pause();
        videoPrincipal.hidden = true;
      }
      imagemPrincipal.hidden = false;
      imagemPrincipal.src = botao.dataset.src;
    }
    miniaturas.forEach((b) => b.classList.remove("ativa"));
    botao.classList.add("ativa");
  }

  miniaturas.forEach((botao, i) => {
    botao.addEventListener("click", () => mostrarMidia(i));
  });

  const setaAnterior = document.getElementById("seta-anterior");
  const setaProxima = document.getElementById("seta-proxima");
  if (setaAnterior) setaAnterior.addEventListener("click", () => mostrarMidia(indiceAtual - 1));
  if (setaProxima) setaProxima.addEventListener("click", () => mostrarMidia(indiceAtual + 1));

  /* ---------- Variação (capacidade) ---------- */
  const idProdutoBase = produto.id;
  const nomeProdutoBase = produto.nome;
  const opcoesVariacao = Array.from(document.querySelectorAll(".opcao-variacao:not(.opcao-simples)"));

  function formatarMoeda(valor) {
    return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function selecionarVariacao(botao) {
    opcoesVariacao.forEach((b) => b.classList.remove("ativa"));
    botao.classList.add("ativa");

    const precoPix = Number(botao.dataset.precoPix);
    const precoDe = Number(botao.dataset.precoDe);

    produto.id = `${idProdutoBase}::${botao.dataset.id}`;
    produto.nome = `${nomeProdutoBase} - ${botao.dataset.capacidade}`;
    produto.precoPix = precoPix;

    document.getElementById("preco-pix-valor").textContent = formatarMoeda(precoPix);
    document.getElementById("preco-de").textContent = `De ${formatarMoeda(precoDe)}`;
    document.getElementById("selo-off").textContent = `🏷️ ${Math.round((1 - precoPix / precoDe) * 100)}% OFF`;
  }

  opcoesVariacao.forEach((botao) => {
    botao.addEventListener("click", () => selecionarVariacao(botao));
  });

  if (opcoesVariacao.length) selecionarVariacao(opcoesVariacao[0]);

  /* ---------- Opções sem impacto no preço (ex.: voltagem) ---------- */
  const gruposOpcoes = Array.from(document.querySelectorAll("[data-opcao-grupo]"));
  const selecaoOpcoes = {};

  gruposOpcoes.forEach((grupo) => {
    const botoesGrupo = Array.from(grupo.querySelectorAll(".opcao-simples"));
    botoesGrupo.forEach((botao) => {
      botao.addEventListener("click", () => {
        botoesGrupo.forEach((b) => b.classList.remove("ativa"));
        botao.classList.add("ativa");
        selecaoOpcoes[botao.dataset.grupo] = botao;
      });
    });
  });

  function aplicarOpcoesNoProduto() {
    const grupoFaltante = gruposOpcoes.find((g) => !selecaoOpcoes[g.dataset.opcaoGrupo]);
    if (grupoFaltante) {
      carrinho.mostrarToast(`Selecione: ${grupoFaltante.dataset.opcaoGrupoNome}`);
      return false;
    }
    const botoesEscolhidos = gruposOpcoes.map((g) => selecaoOpcoes[g.dataset.opcaoGrupo]);
    produto.id = `${idProdutoBase}::${botoesEscolhidos.map((b) => b.dataset.id).join("+")}`;
    produto.nome = `${nomeProdutoBase} - ${botoesEscolhidos.map((b) => b.dataset.label).join(" - ")}`;
    return true;
  }

  /* ---------- Quantidade / estoque ---------- */
  const inputQtd = document.getElementById("input-qtd");
  const estoqueInfo = document.getElementById("estoque-info");
  const btnComprar = document.getElementById("btn-comprar");

  function atualizarEstoqueInfo() {
    if (produto.estoque <= 0) {
      estoqueInfo.textContent = "Produto esgotado";
      estoqueInfo.className = "estoque-info esgotado";
      btnComprar.disabled = true;
    } else if (produto.estoque <= 5) {
      estoqueInfo.textContent = `Últimas ${produto.estoque} unidades`;
      estoqueInfo.className = "estoque-info baixo";
    } else {
      estoqueInfo.textContent = `${produto.estoque} em estoque`;
      estoqueInfo.className = "estoque-info disponivel";
    }
  }
  atualizarEstoqueInfo();

  document.getElementById("btn-menos").addEventListener("click", () => {
    inputQtd.value = Math.max(1, parseInt(inputQtd.value, 10) - 1);
  });
  document.getElementById("btn-mais").addEventListener("click", () => {
    inputQtd.value = Math.min(produto.estoque, parseInt(inputQtd.value, 10) + 1);
  });
  inputQtd.addEventListener("change", () => {
    let v = parseInt(inputQtd.value, 10) || 1;
    v = Math.max(1, Math.min(produto.estoque, v));
    inputQtd.value = v;
  });

  function quantidadeAtual() {
    return Math.max(1, Math.min(produto.estoque, parseInt(inputQtd.value, 10) || 1));
  }

  btnComprar.addEventListener("click", () => {
    if (gruposOpcoes.length && !aplicarOpcoesNoProduto()) return;
    btnComprar.disabled = true;
    btnComprar.innerHTML = `<span class="spinner"></span> Preparando compra...`;
    carrinho.adicionarItem(produto, quantidadeAtual());
    window.location.href = "/checkout";
  });

  /* ---------- Cálculo de frete ---------- */
  const formFrete = document.getElementById("form-frete");
  const inputCep = document.getElementById("input-cep");
  const resultadoFrete = document.getElementById("resultado-frete");

  inputCep.addEventListener("input", () => {
    const digitos = inputCep.value.replace(/\D/g, "").slice(0, 8);
    inputCep.value = digitos.length > 5 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : digitos;
  });

  formFrete.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const digitos = inputCep.value.replace(/\D/g, "");
    resultadoFrete.classList.remove("gratis", "info", "erro");

    if (digitos.length !== 8) {
      resultadoFrete.textContent = "Digite um CEP válido com 8 dígitos.";
      resultadoFrete.classList.add("erro", "mostrar");
      return;
    }

    const subtotal = produto.precoPix * quantidadeAtual();
    if (subtotal >= loja.freteGratisAcima) {
      resultadoFrete.textContent = `🎉 Frete grátis para o CEP ${inputCep.value} — seu pedido já se qualifica!`;
      resultadoFrete.classList.add("gratis", "mostrar");
    } else {
      resultadoFrete.textContent = `Frete calculado no checkout, de acordo com o endereço completo para o CEP ${inputCep.value}.`;
      resultadoFrete.classList.add("info", "mostrar");
    }
  });

  /* ---------- Avaliações ---------- */
  const btnFazerAvaliacao = document.getElementById("btn-fazer-avaliacao");
  if (btnFazerAvaliacao) {
    btnFazerAvaliacao.addEventListener("click", () => {
      carrinho.mostrarToast("Em breve você poderá avaliar este produto por aqui.");
    });
  }

  const filtroNotas = document.getElementById("filtro-notas");
  if (filtroNotas) {
    const itensAvaliacao = Array.from(document.querySelectorAll(".avaliacao-item"));
    const semResultado = document.getElementById("sem-avaliacoes-filtro");
    const botoesFiltro = Array.from(filtroNotas.querySelectorAll(".filtro-nota"));
    let notaAtiva = null;

    function aplicarFiltro() {
      let visiveis = 0;
      itensAvaliacao.forEach((item) => {
        const mostrar = notaAtiva === null || item.dataset.estrelas === String(notaAtiva);
        item.style.display = mostrar ? "" : "none";
        if (mostrar) visiveis++;
      });
      semResultado.classList.toggle("mostrar", visiveis === 0);
    }

    botoesFiltro.forEach((botao) => {
      botao.addEventListener("click", () => {
        const nota = parseInt(botao.dataset.estrelas, 10);
        notaAtiva = notaAtiva === nota ? null : nota;
        botoesFiltro.forEach((b) => b.classList.toggle("ativo", parseInt(b.dataset.estrelas, 10) === notaAtiva));
        aplicarFiltro();
      });
    });
  }

  /* ---------- Fotos de clientes (lightbox) ---------- */
  const lightbox = document.getElementById("lightbox-foto");
  if (lightbox) {
    const lightboxImagem = document.getElementById("lightbox-imagem");
    const lightboxFechar = document.getElementById("lightbox-fechar");

    document.querySelectorAll(".miniatura-foto-cliente").forEach((botao) => {
      botao.addEventListener("click", () => {
        lightboxImagem.src = botao.dataset.foto;
        lightbox.classList.add("aberto");
      });
    });

    function fecharLightbox() {
      lightbox.classList.remove("aberto");
      lightboxImagem.src = "";
    }
    lightboxFechar.addEventListener("click", fecharLightbox);
    lightbox.addEventListener("click", (ev) => {
      if (ev.target === lightbox) fecharLightbox();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") fecharLightbox();
    });
  }

  /* ---------- Carrossel de relacionados ---------- */
  const trilhoRelacionados = document.getElementById("trilho-relacionados");
  if (trilhoRelacionados) {
    const setaRelAnterior = document.getElementById("relacionados-anterior");
    const setaRelProxima = document.getElementById("relacionados-proxima");
    const passo = () => trilhoRelacionados.clientWidth * 0.8;

    setaRelAnterior.addEventListener("click", () => {
      trilhoRelacionados.scrollBy({ left: -passo(), behavior: "smooth" });
    });
    setaRelProxima.addEventListener("click", () => {
      trilhoRelacionados.scrollBy({ left: passo(), behavior: "smooth" });
    });
  }
})();
