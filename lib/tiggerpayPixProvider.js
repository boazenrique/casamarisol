const QRCode = require("qrcode");

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

class TiggerPayPixProvider {
  async request(path, body) {
    const key = process.env.TIGGERPAY_API_KEY?.trim();
    if (!key) throw new Error("TIGGERPAY_API_KEY nao configurada.");
    const response = await fetch(`https://api.tiggerpayments.com${path}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      throw new Error(`TiggerPay: falha na API (HTTP ${response.status}).`);
    }
    return data;
  }

  async createCharge({ valor, descricao, cliente, endereco }) {
    const amount = Math.round(Number(valor) * 100);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Valor Pix invalido.");
    const customer = {
      name: cliente?.nome,
      email: cliente?.email,
      cellphone: digits(cliente?.telefone),
      taxId: digits(cliente?.cpf),
    };
    if (!customer.name || !customer.email) throw new Error("Nome e email obrigatorios.");
    if (endereco) customer.address = {
      zipCode: endereco.cep, street: endereco.rua, number: endereco.numero,
      complement: endereco.complemento, city: endereco.cidade, state: endereco.uf,
    };
    const body = { amount, description: descricao, customer };
    if (process.env.PUBLIC_BASE_URL?.trim()) body.site_url = process.env.PUBLIC_BASE_URL.trim();
    const data = await this.request("/create-pix-duck", body);
    const copiaECola = data.pix_code || data.pix_qr_code;
    if (typeof data.txid !== "string" || !data.txid.trim() || typeof copiaECola !== "string" || !copiaECola.trim()) {
      throw new Error("TiggerPay: resposta sem txid ou codigo Pix valido.");
    }
    return {
      provider: "tiggerpay",
      providerChargeId: data.txid,
      copiaECola,
      qrCodeDataUrl: await QRCode.toDataURL(copiaECola, { margin: 1, width: 280 }),
      ambiente: "producao",
    };
  }

  async getStatus({ transactionId } = {}) {
    if (!transactionId) return null;
    const data = await this.request(`/api/verificar-pix/${encodeURIComponent(transactionId)}`);
    if (data.status === "approved") return "pago";
    if (data.status === "pendente") return "pendente";
    return null;
  }

  // Webhooks nao possuem assinatura documentada: conferir a venda na API.
  async verifyPaidSale(transactionId, total) {
    for (let page = 1; page <= 100; page++) {
      const sales = await this.request(`/api/vendas?page=${page}`);
      if (!Array.isArray(sales)) throw new Error("TiggerPay: lista de vendas invalida.");
      const sale = sales.find((item) => item.txid === transactionId);
      if (sale) return sale.status === "approved" &&
        Math.round(Number(sale.valor) * 100) === Math.round(Number(total) * 100);
      if (sales.length < 50) return false;
    }
    return false;
  }
}

module.exports = { TiggerPayPixProvider };
