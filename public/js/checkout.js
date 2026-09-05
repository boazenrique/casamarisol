(async function () {
  const cart = window.CasaMarisolCarrinho;
  const items = await cart.sincronizarCarrinho();
  const button = document.getElementById("btn-finalizar");
  const error = document.getElementById("erro-form");
  let timer;
  if (!items.length) return void (location.href = "/carrinho");

  document.getElementById("resumo-itens").innerHTML = items.map((item) => `<article class="resumo-produto"><img src="${item.imagem}" alt=""><div><strong>${item.nome}</strong><small>${item.quantidade} unidade${item.quantidade > 1 ? "s" : ""}</small></div><b>${cart.formatarMoeda(item.quantidade * item.precoPix)}</b></article>`).join("");
  const total = cart.totalCarrinho(items);
  document.getElementById("resumo-subtotal").textContent = cart.formatarMoeda(total);
  document.getElementById("resumo-total-valor").textContent = cart.formatarMoeda(total);

  function activateStep(number) {
    document.querySelectorAll(".etapa").forEach((section) => {
      const step = Number(section.dataset.step);
      section.classList.toggle("ativa", step === number);
      section.classList.toggle("concluida", step < number);
      section.classList.toggle("bloqueada", step > number);
    });
    document.querySelector(`.etapa[data-step="${number}"]`).scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function validateStep(number) {
    const fields = document.querySelectorAll(`.etapa[data-step="${number}"] input[required]`);
    for (const field of fields) {
      if (!field.checkValidity()) { field.reportValidity(); field.focus(); return false; }
    }
    return true;
  }

  document.querySelectorAll(".btn-proxima").forEach((next) => {
    next.addEventListener("click", () => {
      const current = Number(next.closest(".etapa").dataset.step);
      if (validateStep(current)) activateStep(Number(next.dataset.next));
    });
  });

  document.querySelectorAll(".etapa-titulo").forEach((header) => {
    header.addEventListener("click", () => {
      const section = header.closest(".etapa");
      if (!section.classList.contains("bloqueada")) activateStep(Number(section.dataset.step));
    });
  });

  const digits = (value) => value.replace(/\D/g, "");
  const cpf = document.getElementById("cpf"), phone = document.getElementById("telefone"), cep = document.getElementById("cep");
  cpf.oninput = () => { const v = digits(cpf.value).slice(0, 11); cpf.value = v.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2"); };
  phone.oninput = () => { const v = digits(phone.value).slice(0, 11); phone.value = v.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{4})$/, "$1-$2"); };
  let cepConsultado = "";
  let buscaCepAtual;
  async function buscarCep() {
    const cepLimpo = digits(cep.value);
    const status = document.getElementById("cep-status");
    if (cepLimpo.length !== 8 || cepLimpo === cepConsultado) return;
    if (buscaCepAtual) buscaCepAtual.abort();
    buscaCepAtual = new AbortController();
    status.className = "cep-status buscando"; status.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Buscando endereço...';
    cep.setAttribute("aria-busy", "true");
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`, { signal: buscaCepAtual.signal });
      if (!response.ok) throw new Error("Falha na consulta");
      const data = await response.json();
      if (data.erro) throw new Error("CEP não encontrado");
      document.getElementById("rua").value = data.logradouro || "";
      document.getElementById("bairro").value = data.bairro || "";
      document.getElementById("cidade").value = data.localidade || "";
      document.getElementById("uf").value = data.uf || "";
      cepConsultado = cepLimpo;
      status.className = "cep-status encontrado"; status.innerHTML = '<i class="fa-solid fa-circle-check"></i> Endereço encontrado';
      (data.logradouro ? document.getElementById("numero") : document.getElementById("rua")).focus();
    } catch (err) {
      if (err.name === "AbortError") return;
      status.className = "cep-status erro";
      status.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${err.message === "CEP não encontrado" ? err.message : "Não foi possível consultar. Preencha manualmente."}`;
    } finally { cep.removeAttribute("aria-busy"); }
  }
  cep.oninput = () => {
    cep.value = digits(cep.value).slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");
    if (digits(cep.value).length < 8) { cepConsultado = ""; const status = document.getElementById("cep-status"); status.textContent = ""; status.className = "cep-status"; }
    if (digits(cep.value).length === 8) buscarCep();
  };
  cep.addEventListener("blur", buscarCep);
  document.getElementById("uf").oninput = (event) => { event.target.value = event.target.value.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 2); };

  function paid(status) {
    if (status !== "pago") return;
    const el = document.getElementById("status-pagamento");
    el.innerHTML = '<i class="fa-solid fa-circle-check"></i> Pagamento confirmado! Estamos preparando seu pedido.';
    el.className = "status-pagamento pago"; clearInterval(timer);
  }
  function showPix(data) {
    document.getElementById("pix-pedido-id").textContent = data.id; document.getElementById("pix-qr-code").src = data.pagamento.qrCodeDataUrl;
    document.getElementById("pix-copia-cola").value = data.pagamento.copiaECola; document.getElementById("pix-valor").textContent = cart.formatarMoeda(data.total);
    document.querySelector(".checkout-colunas").setAttribute("inert", "");
    document.getElementById("checkout-pix").hidden = false;
    document.body.style.overflow = "hidden";
    timer = setInterval(async () => { try { const response = await fetch(`/api/pedidos/${encodeURIComponent(data.id)}/status`); if (response.ok) paid((await response.json()).status); } catch (_) {} }, 4000);
  }
  document.getElementById("btn-copiar-pix").onclick = async (event) => { const field = document.getElementById("pix-copia-cola"); try { await navigator.clipboard.writeText(field.value); } catch (_) { field.select(); document.execCommand("copy"); } event.currentTarget.textContent = "Copiado!"; setTimeout(() => event.currentTarget.textContent = "Copiar", 1800); };
  document.getElementById("form-checkout").onsubmit = async (event) => {
    event.preventDefault();
    if (!document.querySelector('.etapa[data-step="3"]').classList.contains("ativa")) return;
    error.style.display = "none"; button.disabled = true; button.textContent = "Criando pedido...";
    const f = event.target;
    const cliente = { nome: f.nome.value.trim(), cpf: f.cpf.value, email: f.email.value.trim(), telefone: f.telefone.value };
    const endereco = { cep: f.cep.value, rua: f.rua.value.trim(), numero: f.numero.value.trim(), complemento: f.complemento.value.trim(), bairro: f.bairro.value.trim(), cidade: f.cidade.value.trim(), uf: f.uf.value };
    const clickId = typeof DTrack !== "undefined" && typeof DTrack.getClickId === "function" ? DTrack.getClickId() : null;
    try { const response = await fetch("/api/pedidos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cliente, endereco, itens: items, clickId }) }); const data = await response.json(); if (!response.ok) throw new Error(data.erro || "Não foi possível gerar o pagamento."); cart.limparCarrinho(); showPix(data); }
    catch (err) { error.textContent = err.message; error.style.display = "block"; button.disabled = false; button.textContent = "Confirmar pedido"; }
  };
})();
