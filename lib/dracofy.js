const DRACOFY_WEBHOOK_URL =
  process.env.DRACOFY_WEBHOOK_URL ||
  "https://api.dracofy.com.br/webhook/pt_4519b7460cba71257c50fe45aca8e57f";

/**
 * Notifica a Dracofy sobre a confirmação de pagamento de um pedido, para
 * que ela dispare o evento Purchase ao Meta Ads com o click_id correto.
 *
 * Repassamos o click_id que nós mesmos guardamos ao criar o pedido, em vez
 * de depender do gateway (ZuckPay) devolvê-lo no webhook dele — isso evita
 * quebrar caso o gateway não propague campos customizados.
 */
async function notificarDracofy(pedido) {
  if (!pedido?.clickId) return;

  const payload = {
    click_id: pedido.clickId,
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
    });
    if (!resp.ok) {
      console.warn(`Aviso: Dracofy respondeu HTTP ${resp.status} para o pedido ${pedido.id}.`);
    }
  } catch (err) {
    console.warn(`Aviso: falha ao notificar Dracofy do pedido ${pedido.id}:`, err.message);
  }
}

module.exports = { notificarDracofy };
