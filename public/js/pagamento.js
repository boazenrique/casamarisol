(function () {
  const pedido = window.__PEDIDO__;
  const statusEl = document.getElementById("status-pagamento");
  let intervalo;

  function aplicarStatus(status) {
    if (status === "pago") {
      statusEl.textContent = "✅ Pagamento confirmado! Seu pedido está sendo preparado.";
      statusEl.classList.remove("pendente");
      statusEl.classList.add("pago");
      clearInterval(intervalo);
      const btnSimular = document.getElementById("btn-simular");
      if (btnSimular) btnSimular.style.display = "none";
    }
  }

  async function verificarStatus() {
    try {
      const resp = await fetch(`/api/pedidos/${pedido.id}/status`);
      const dados = await resp.json();
      aplicarStatus(dados.status);
    } catch (err) {
      console.error("Erro ao verificar status do pagamento:", err);
    }
  }

  if (pedido.status !== "pago") {
    intervalo = setInterval(verificarStatus, 4000);
  } else {
    aplicarStatus("pago");
  }

  const btnCopiar = document.getElementById("btn-copiar");
  btnCopiar.addEventListener("click", async () => {
    const campo = document.getElementById("copia-cola");
    campo.select();
    try {
      await navigator.clipboard.writeText(campo.value);
      btnCopiar.textContent = "Copiado!";
    } catch (e) {
      document.execCommand("copy");
      btnCopiar.textContent = "Copiado!";
    }
    setTimeout(() => (btnCopiar.textContent = "Copiar código"), 2000);
  });

  const btnSimular = document.getElementById("btn-simular");
  if (btnSimular) {
    btnSimular.addEventListener("click", async () => {
      btnSimular.disabled = true;
      btnSimular.textContent = "Confirmando...";
      try {
        const resp = await fetch(`/api/pedidos/${pedido.id}/simular-pagamento`, { method: "POST" });
        const dados = await resp.json();
        aplicarStatus(dados.status);
      } catch (err) {
        btnSimular.disabled = false;
        btnSimular.textContent = "Simular confirmação de pagamento (teste)";
      }
    });
  }
})();
