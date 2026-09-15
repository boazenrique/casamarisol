const DRACOFY_WEBHOOK_URL =
  process.env.DRACOFY_WEBHOOK_URL ||
  "https://api.dracofy.com.br/webhook/pt_4519b7460cba71257c50fe45aca8e57f";

const orderStore = require("./orderStore");
const { normalizeAttribution } = require("./attribution");
const inFlight = new Map();

/**
 * Notifica a Dracofy sobre a confirmação de pagamento de um pedido, para
 * que ela dispare o evento Purchase ao Meta Ads com o click_id correto.
 *
 * Repassamos o click_id que nós mesmos guardamos ao criar o pedido, em vez
 * de depender do gateway (ZuckPay) devolvê-lo no webhook dele — isso evita
 * quebrar caso o gateway não propague campos customizados.
 */
async function enviar(pedido) {
  if (!pedido || pedido.status !== "pago") return;
  pedido = orderStore.findById(pedido.id) || pedido;
  if (pedido.dracofy?.enviadoEm) return;
  const attribution = normalizeAttribution(pedido.attribution, pedido.clickId);
  if (!Object.keys(attribution).some((key) => key !== "fbp")) {
    if (pedido.dracofy?.status !== "sem_atribuicao") {
      console.warn(`Dracofy: pedido ${pedido.id} sem dados de atribuição.`);
      orderStore.update(pedido.id, { dracofy: { status: "sem_atribuicao" } });
    }
    return;
  }
  if (pedido.dracofy?.tentadoEm && Date.now() - Date.parse(pedido.dracofy.tentadoEm) < 30000) return;
  const tentadoEm = new Date().toISOString();
  orderStore.update(pedido.id, { dracofy: { status: "enviando", tentadoEm } });

  const payload = {
    ...attribution,
    external_id: pedido.id,
    status: "paid",
    valor: pedido.total,
    cliente: {
      nome: pedido.cliente?.nome,
      email: pedido.cliente?.email,
      telefone: pedido.cliente?.telefone,
    },
  };

  try {
    const resp = await fetch(DRACOFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    orderStore.update(pedido.id, { dracofy: { status: "enviado", tentadoEm, enviadoEm: new Date().toISOString() } });
  } catch (err) {
    orderStore.update(pedido.id, { dracofy: { status: "falhou", tentadoEm } });
    console.warn(`Aviso: falha ao notificar Dracofy do pedido ${pedido.id}:`, err.message);
  }
}

function notificarDracofy(pedido) {
  if (!pedido?.id) return Promise.resolve();
  if (inFlight.has(pedido.id)) return inFlight.get(pedido.id);
  const pending = enviar(pedido).finally(() => inFlight.delete(pedido.id));
  inFlight.set(pedido.id, pending);
  return pending;
}

module.exports = { notificarDracofy };
