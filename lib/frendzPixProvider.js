const QRCode = require("qrcode");
const { normalizeAttribution } = require("./attribution");

const BASE_URL = "https://api.frendz.com.br/api/public/v1";
const digits = (value) => String(value || "").replace(/\D/g, "");

function cents(value) {
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error("Frendz: valor do pagamento invalido.");
  }
  return result;
}

async function request(path, body) {
  const token = process.env.FRENDZ_API_TOKEN?.trim();
  if (!token) throw Object.assign(new Error("FRENDZ_API_TOKEN nao configurado."), { code: "FRENDZ_NOT_CONFIGURED" });
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("api_token", token);
  let response;
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
  } catch (_) {
    // O erro original pode conter a URL com api_token. Nunca repassa-lo.
    throw Object.assign(new Error("Frendz: falha de conexao com a API."), { code: "FRENDZ_NETWORK_ERROR" });
  }
  if (!response.ok) throw Object.assign(new Error(`Frendz: requisicao recusada (HTTP ${response.status}).`),
    { code: "FRENDZ_HTTP_ERROR", providerStatus: response.status });
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== "object") throw new Error("Frendz: resposta invalida.");
  return data.data || data;
}

function buildCharge({ orderId, valor, descricao, cliente, endereco = {}, itens, attribution, clickId }) {
  const offerHash = (process.env.FRENDZ_OFFER_HASH ?? "y0zsnvpsae").trim();
  const productHash = (process.env.FRENDZ_PRODUCT_HASH ?? "8ldhilcbed").trim();
  if (!offerHash || !productHash) throw new Error("FRENDZ_OFFER_HASH / FRENDZ_PRODUCT_HASH nao configurados.");
  if (!Array.isArray(itens) || !itens.length) throw new Error("Frendz: carrinho vazio.");
  const amounts = itens.map((item) => {
    if (!Number.isSafeInteger(item.quantidade) || item.quantidade < 1) {
      throw new Error("Frendz: quantidade invalida.");
    }
    return cents(item.precoUnitario) * item.quantidade;
  });
  const amount = cents(valor);
  if (amounts.reduce((sum, value) => sum + value, 0) !== amount) {
    throw new Error("Frendz: total diferente dos itens do carrinho.");
  }
  if (!cliente?.nome || !cliente?.email ||
      (cliente.cpf && ![11, 14].includes(digits(cliente.cpf).length)) ||
      (cliente.telefone && digits(cliente.telefone).length < 10)) {
    throw new Error("Frendz: dados do cliente incompletos.");
  }
  const tracking = normalizeAttribution(attribution, clickId);
  const body = {
    amount, offer_hash: offerHash, payment_method: "pix",
    customer: {
      name: cliente.nome, email: cliente.email,
      ...(cliente.telefone ? { phone_number: digits(cliente.telefone) } : {}),
      ...(cliente.cpf ? { document: digits(cliente.cpf) } : {}),
      street_name: endereco.rua, number: endereco.numero, complement: endereco.complemento,
      neighborhood: endereco.bairro, city: endereco.cidade, state: endereco.uf,
      zip_code: digits(endereco.cep),
    },
    cart: [{
      product_hash: productHash, title: descricao || `Pagamento do pedido ${orderId} - Casa Marisol`,
      price: amount, quantity: 1, operation_type: 1, tangible: false,
    }],
    expire_in_days: 1, transaction_origin: "api",
    tracking: Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]
      .filter((key) => tracking[key]).map((key) => [key, tracking[key]])),
  };
  const base = (process.env.PUBLIC_BASE_URL || "https://www.casamarisolshop.com.br").trim();
  if (base) {
    let url;
    try { url = new URL(base); } catch (_) { throw new Error("PUBLIC_BASE_URL invalida."); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new Error("PUBLIC_BASE_URL deve ser uma URL publica HTTPS.");
    }
    body.postback_url = `${base.replace(/\/$/, "")}/api/webhooks/frendz?pedido=${encodeURIComponent(orderId)}`;
  }
  return body;
}

function statusOf(transaction) {
  return ({ pending: "pendente", waiting_payment: "pendente", processing: "pendente",
    paid: "pago", canceled: "cancelado", refused: "cancelado", refunded: "reembolsado",
    chargedback: "reembolsado" })[transaction.status] || null;
}

class FrendzPixProvider {
  async createCharge(input) {
    const body = buildCharge(input);
    const transaction = await request("/transactions", body);
    return this.parseCharge(transaction);
  }

  async parseCharge(transaction) {
    const hash = transaction.hash || transaction.transaction_hash;
    const code = transaction.pix?.code;
    if (typeof hash !== "string" || !hash || typeof code !== "string" || !code) {
      throw new Error("Frendz: resposta sem identificador ou codigo Pix. Verifique a transacao no painel antes de repetir.");
    }
    return {
      provider: "frendz", providerChargeId: hash, transaction_hash: hash, copiaECola: code,
      qrCodeDataUrl: await QRCode.toDataURL(code, { margin: 1, width: 280 }),
      expiraEm: transaction.pix.expires_at || undefined, ambiente: "producao",
    };
  }

  async getStatus({ transactionId, valor } = {}) {
    if (!transactionId) return null;
    const transaction = await request(`/transactions/${encodeURIComponent(transactionId)}`);
    const hash = transaction.hash || transaction.transaction_hash;
    if (hash !== transactionId || (transaction.payment_method || transaction.method) !== "pix" ||
        (valor !== undefined && Number(transaction.amount) !== cents(valor))) {
      throw new Error("Frendz: transacao consultada nao corresponde ao pedido.");
    }
    return statusOf(transaction);
  }
}

module.exports = { FrendzPixProvider, buildCharge };
