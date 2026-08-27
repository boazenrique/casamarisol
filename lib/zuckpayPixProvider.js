const BASE_URL = process.env.ZUCKPAY_BASE_URL || "https://www.zuckpay.com.br/conta/v3";

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function authHeader() {
  const clientId = process.env.ZUCKPAY_CLIENT_ID;
  const clientSecret = process.env.ZUCKPAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("ZUCKPAY_CLIENT_ID / ZUCKPAY_CLIENT_SECRET não configurados.");
  }
  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

function webhookUrl() {
  const base = process.env.PUBLIC_BASE_URL;
  return base ? `${base.replace(/\/$/, "")}/api/webhooks/pix` : undefined;
}

/**
 * Provider Pix real via ZuckPay (https://www.zuckpay.com.br).
 * Gera QRCode dinâmico e consulta status pela API oficial.
 */
class ZuckPayPixProvider {
  async createCharge({ orderId, valor, descricao, cliente }) {
    const body = {
      nome: cliente?.nome,
      cpf: digitsOnly(cliente?.cpf),
      valor,
      email: cliente?.email,
      telefone: digitsOnly(cliente?.telefone),
      descricao,
      external_id_client: orderId,
    };
    const urlnoty = webhookUrl();
    if (urlnoty) body.urlnoty = urlnoty;

    const resp = await fetch(`${BASE_URL}/pix/qrcode`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(),
      },
      body: JSON.stringify(body),
    });

    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data) {
      const motivo = data?.message ? `: ${data.message}` : "";
      throw new Error(`ZuckPay: falha ao gerar QRCode Pix (HTTP ${resp.status})${motivo}`);
    }

    return {
      providerChargeId: data.transactionId,
      copiaECola: data.qrcode || data.pix_code,
      qrCodeDataUrl: data.qrcode_image,
      expiraEm: data.calendar?.expiration
        ? new Date(Date.now() + data.calendar.expiration * 1000).toISOString()
        : undefined,
      ambiente: "producao",
    };
  }

  async getStatus({ transactionId, externalId } = {}) {
    const query = transactionId
      ? `transactionId=${encodeURIComponent(transactionId)}`
      : externalId
      ? `external_id_client=${encodeURIComponent(externalId)}`
      : null;
    if (!query) return null;

    const resp = await fetch(`${BASE_URL}/pix/status?${query}`, {
      headers: { Authorization: authHeader() },
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data?.status) return null;

    switch (data.status) {
      case "PAID":
        return "pago";
      case "PENDING":
        return "pendente";
      default:
        return null;
    }
  }
}

module.exports = { ZuckPayPixProvider };
