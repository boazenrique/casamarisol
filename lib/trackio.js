const crypto = require("node:crypto");
const orderStore = require("./orderStore");
const produtosCatalogo = require("./products");

/**
 * Contrato real do Trackio (confirmado pelo responsavel da loja):
 * - checkout-started: POST {TRACKIO_ORIGIN}/api/webhooks/checkout-started/{slug}
 * - payment_approved: POST {TRACKIO_ORIGIN}/api/webhooks/zuckpay/{slug}
 *   (endpoint generico do Trackio, no formato do webhook da ZuckPay, usado
 *   tambem para outros gateways).
 * Assinatura: HMAC SHA-256 de "{timestamp}.{rawJson}" com TRACKIO_WEBHOOK_SECRET,
 * enviada no header X-ZuckPay-Signature: t={timestamp},v1={hmacHex}.
 */
function config() {
  const origin = process.env.TRACKIO_ORIGIN?.trim();
  const slug = process.env.TRACKIO_STORE_SLUG?.trim();
  const secret = process.env.TRACKIO_WEBHOOK_SECRET?.trim();
  if (!origin || !slug || !secret) return null;
  return { origin: origin.replace(/\/$/, ""), slug, secret };
}

function assinatura(secret, timestamp, rawJson) {
  const hmac = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawJson}`).digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

async function post(url, payload, secret) {
  // Serializa o body uma unica vez: a mesma string e assinada e enviada.
  const rawJson = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-ZuckPay-Signature": assinatura(secret, timestamp, rawJson) },
    body: rawJson,
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Trackio: requisicao recusada (HTTP ${resp.status}).`);
}

// Somente URL publica HTTPS; nunca uma data URL (o QR exibido no checkout e
// gerado localmente em base64 e nunca deve ser enviado como se fosse publico).
function urlPublicaHttps(url) {
  if (typeof url !== "string" || !url) return undefined;
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch (_) {
    return undefined;
  }
}

function comprador(cliente = {}) {
  return {
    email: cliente.email || undefined,
    nome: cliente.nome || undefined,
    phone: cliente.telefone || undefined,
    cpf: cliente.cpf || undefined,
  };
}

// A Frendz reutiliza o mesmo FRENDZ_OFFER_HASH/FRENDZ_PRODUCT_HASH para os 8
// produtos da loja — eles nunca identificam qual item foi comprado. O
// produto real vem do pedido local (itens do carrinho), mapeado para o
// Trackio por TRACKIO_PRODUCTS_JSON: { "<id-local-do-produto>": { "codigo": "...", "nome": "..." } }.
function mapaProdutosTrackio() {
  const raw = process.env.TRACKIO_PRODUCTS_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.warn("Trackio: TRACKIO_PRODUCTS_JSON invalido (JSON malformado); nenhum produto mapeado.", err.message);
    return {};
  }
}

// Ids de variacao/opcao vem como "idBase::variacao" (ver lib/products.js);
// o mapeamento Trackio e por produto base, nao por variacao especifica.
function idBaseDoItem(item) {
  return String(item?.id || "").split("::")[0];
}

// O item principal e o primeiro item do pedido que nao e order bump (todo
// pedido exige exatamente um, conferido na criacao em routes/api.js).
function idProdutoPrincipal(pedido) {
  const itens = Array.isArray(pedido?.itens) ? pedido.itens : [];
  for (const item of itens) {
    const idBase = idBaseDoItem(item);
    const info = produtosCatalogo.buscarPorId(idBase);
    if (info && !info.orderBump) return idBase;
  }
  return undefined;
}

// Resolve o produto real do pedido (codigo + nome Trackio) a partir do
// catalogo local e de TRACKIO_PRODUCTS_JSON. Nunca usa FRENDZ_OFFER_HASH /
// FRENDZ_PRODUCT_HASH para identificar o item - ambos sao iguais para
// qualquer produto da loja. Retorna null (e loga um aviso) se nao houver
// mapeamento, para nunca enviar ao Trackio um produto incorreto/adivinhado.
function produtoDoPedido(pedido) {
  const idLocal = idProdutoPrincipal(pedido);
  const entrada = idLocal ? mapaProdutosTrackio()[idLocal] : undefined;
  if (!entrada?.codigo || !entrada?.nome) {
    console.warn(`Trackio: pedido ${pedido?.id} sem mapeamento em TRACKIO_PRODUCTS_JSON ` +
      `(produto local: ${idLocal || "nao identificado"}). Evento nao enviado para evitar produto incorreto.`);
    return null;
  }
  return { id: idLocal, codigo: entrada.codigo, nome: entrada.nome };
}

async function enviarCheckoutIniciado(pedido) {
  if (!pedido?.id || pedido.pagamento?.provider !== "frendz") return;
  const cfg = config();
  if (!cfg) {
    console.warn("Trackio: integracao nao configurada (TRACKIO_ORIGIN/TRACKIO_STORE_SLUG/TRACKIO_WEBHOOK_SECRET).");
    return;
  }
  const atual = (await orderStore.findById(pedido.id)) || pedido;
  // Regra 3 da integracao: nunca disparar recuperacao de checkout para um
  // pedido que ja foi pago, nem reenviar o evento em chamadas repetidas.
  if (atual.status === "pago" || atual.trackio?.checkoutEnviadoEm) return;

  const produto = produtoDoPedido(atual);
  if (!produto) return;

  const cli = comprador(atual.cliente);
  await post(`${cfg.origin}/api/webhooks/checkout-started/${encodeURIComponent(cfg.slug)}`, {
    checkout: {
      id: atual.id,
      email: cli.email,
      nome: cli.nome,
      phone: cli.phone,
      cpf: cli.cpf,
      product_code: produto.codigo,
      product_name: produto.nome,
      checkout_url: urlPublicaHttps(atual.pagamento?.checkoutUrl),
      pix_code: atual.pagamento?.copiaECola || undefined,
      pix_qr_code_url: urlPublicaHttps(atual.pagamento?.qrCodeUrl),
    },
  }, cfg.secret);

  // Salva o produto resolvido no pedido: o webhook de pagamento reutiliza
  // este mesmo valor em vez de tentar identificar o produto de novo.
  await orderStore.update(atual.id, { trackio: { ...atual.trackio, checkoutEnviadoEm: new Date().toISOString(),
    produtoLocalId: produto.id, produtoCodigo: produto.codigo, produtoNome: produto.nome } });
}

async function enviarPagamentoAprovado(pedido) {
  if (!pedido?.id) return;
  const cfg = config();
  if (!cfg) {
    console.warn("Trackio: integracao nao configurada (TRACKIO_ORIGIN/TRACKIO_STORE_SLUG/TRACKIO_WEBHOOK_SECRET).");
    return;
  }
  const atual = (await orderStore.findById(pedido.id)) || pedido;
  if (atual.trackio?.pagamentoEnviadoEm) return;

  // Regra 4: reutiliza o produto salvo no checkout-started deste mesmo
  // pedido. So recalcula (pelo carrinho local, nunca pelo hash da Frendz)
  // se por algum motivo o checkout-started ainda nao tiver resolvido um.
  const produto = atual.trackio?.produtoCodigo && atual.trackio?.produtoNome
    ? { id: atual.trackio.produtoLocalId, codigo: atual.trackio.produtoCodigo, nome: atual.trackio.produtoNome }
    : produtoDoPedido(atual);
  if (!produto) return;

  const cli = comprador(pedido.cliente || atual.cliente);
  await post(`${cfg.origin}/api/webhooks/zuckpay/${encodeURIComponent(cfg.slug)}`, {
    event: "payment_approved",
    transaction: {
      id: pedido.pagamento?.providerChargeId || atual.pagamento?.providerChargeId,
      status: "PAID",
      confirmed_date: pedido.pagoEm || new Date().toISOString(),
      email: cli.email,
      nome: cli.nome,
      phone: cli.phone,
      cpf: cli.cpf,
      product_code: produto.codigo,
      product_name: produto.nome,
      external_id_client: atual.id,
    },
  }, cfg.secret);

  await orderStore.update(atual.id, { trackio: { ...atual.trackio, pagamentoEnviadoEm: new Date().toISOString() } });
}

const inFlight = new Map();
function dedupar(chave, tarefa, aviso) {
  if (inFlight.has(chave)) return inFlight.get(chave);
  const pendente = tarefa().catch((err) => console.warn(aviso, err.message)).finally(() => inFlight.delete(chave));
  inFlight.set(chave, pendente);
  return pendente;
}

function notificarCheckoutIniciado(pedido) {
  if (!pedido?.id) return Promise.resolve();
  return dedupar(`checkout:${pedido.id}`, () => enviarCheckoutIniciado(pedido),
    `Aviso: falha ao notificar Trackio (checkout-started) do pedido ${pedido.id}:`);
}

function notificarPagamentoAprovado(pedido) {
  if (!pedido?.id) return Promise.resolve();
  return dedupar(`pago:${pedido.id}`, () => enviarPagamentoAprovado(pedido),
    `Aviso: falha ao notificar Trackio (payment-approved) do pedido ${pedido.id}:`);
}

module.exports = { notificarCheckoutIniciado, notificarPagamentoAprovado };
