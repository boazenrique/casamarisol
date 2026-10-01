const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const orderStore = require("../lib/orderStore");
const trackio = require("../lib/trackio");
const products = require("../lib/products");
const { FrendzPixProvider } = require("../lib/frendzPixProvider");

const ENV_KEYS = ["FRENDZ_WEBHOOK_TOKEN", "FRENDZ_OFFER_HASH", "FRENDZ_PRODUCT_HASH",
  "TRACKIO_ORIGIN", "TRACKIO_STORE_SLUG", "TRACKIO_WEBHOOK_SECRET", "TRACKIO_PRODUCTS_JSON"];

// Produto real do catalogo (lib/products.js) usado nos testes - o mapeamento
// Trackio e por esse id, nunca pelo offer/product hash da Frendz (regra 5).
const PRODUTO_TESTE_ID = products.listar().find((p) => p.estoque > 0).id;

async function withEnv(values, fn) {
  const previous = ENV_KEYS.map((key) => process.env[key]);
  ENV_KEYS.forEach((key) => {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  });
  try {
    await fn();
  } finally {
    ENV_KEYS.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    });
  }
}

function freshRouter() {
  const routerPath = require.resolve("../routes/api");
  delete require.cache[routerPath];
  return require(routerPath);
}

function getWebhookHandler(router) {
  return router.stack.find((entry) => entry.route?.path === "/frendz/webhook/:token").route.stack[0].handle;
}

function getPedidosHandler(router) {
  return router.stack.find((entry) => entry.route?.path === "/pedidos").route.stack[0].handle;
}

// Confere a assinatura real do Trackio: header "X-ZuckPay-Signature:
// t={timestamp},v1={hmacHex}", hmac = HMAC-SHA256("{timestamp}.{rawJson}").
function assinaturaValida(headerValue, rawJson, secret) {
  const match = /^t=(\d+),v1=([0-9a-f]+)$/.exec(headerValue || "");
  if (!match) return false;
  const [, timestamp, hmac] = match;
  const esperado = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawJson}`).digest("hex");
  return hmac === esperado;
}

const TRACKIO_ENV = {
  FRENDZ_WEBHOOK_TOKEN: "segredo-valido-da-loja",
  FRENDZ_OFFER_HASH: "offer-hash",
  FRENDZ_PRODUCT_HASH: "product-hash",
  TRACKIO_ORIGIN: "https://track-io.example.invalid",
  TRACKIO_STORE_SLUG: "casa-marisol",
  TRACKIO_WEBHOOK_SECRET: "trackio-secret",
  TRACKIO_PRODUCTS_JSON: JSON.stringify({ [PRODUTO_TESTE_ID]: { codigo: "COD1", nome: "Produto Teste" } }),
};

function mockStore(pedidoInicial) {
  let pedido = pedidoInicial;
  const originais = {
    findByChargeId: orderStore.findByChargeId, findById: orderStore.findById,
    update: orderStore.update, withOrderLock: orderStore.withOrderLock,
  };
  orderStore.findByChargeId = async (chargeId) => (pedido?.pagamento?.providerChargeId === chargeId ? pedido : null);
  orderStore.findById = async (id) => (pedido?.id === id ? pedido : null);
  orderStore.update = async (id, changes) => { pedido = { ...pedido, ...changes }; return pedido; };
  orderStore.withOrderLock = async (_id, callback) => callback();
  return {
    atual: () => pedido,
    restaurar() {
      orderStore.findByChargeId = originais.findByChargeId;
      orderStore.findById = originais.findById;
      orderStore.update = originais.update;
      orderStore.withOrderLock = originais.withOrderLock;
    },
  };
}

test("webhook Trackio/Frendz: token invalido retorna 401", async () => {
  await withEnv(TRACKIO_ENV, async () => {
    const handler = getWebhookHandler(freshRouter());
    let code;
    await handler({ params: { token: "token-errado" }, body: {} },
      { sendStatus(status) { code = status; return this; } });
    assert.equal(code, 401);
  });
});

test("webhook Trackio/Frendz: pagamento aprovado envia evento assinado e marca o pedido", async () => {
  await withEnv(TRACKIO_ENV, async () => {
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (url, options) => { requests.push({ url, options }); return { ok: true }; };
    const store = mockStore({
      id: "CM-TRACKIO1", status: "pago", total: 50,
      cliente: { nome: "Cliente Teste", email: "cliente@example.invalid" },
      itens: [{ id: PRODUTO_TESTE_ID, quantidade: 1 }],
      pagamento: { provider: "frendz", providerChargeId: "hash-123" },
    });
    try {
      const handler = getWebhookHandler(freshRouter());
      const payload = {
        transaction: {
          id: "hash-123", status: "paid", paid_at: "2026-01-01T00:00:00.000Z",
          customer: { name: "Cliente Teste", email: "cliente@example.invalid", phone: "11999999999", document: "12345678901" },
          pix: { code: "pix-copia-cola", url: "https://pay.frendz.com.br/abc" },
        },
        offer: { hash: "offer-hash" },
      };
      let code;
      await handler({ params: { token: "segredo-valido-da-loja" }, body: payload },
        { sendStatus(status) { code = status; return this; } });
      assert.equal(code, 200);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, "https://track-io.example.invalid/api/webhooks/zuckpay/casa-marisol");
      const sentBody = requests[0].options.body;
      const sentPayload = JSON.parse(sentBody);
      assert.equal(sentPayload.event, "payment_approved");
      assert.equal(sentPayload.transaction.id, "hash-123");
      assert.equal(sentPayload.transaction.status, "PAID");
      assert.equal(sentPayload.transaction.confirmed_date, "2026-01-01T00:00:00.000Z");
      assert.equal(sentPayload.transaction.email, "cliente@example.invalid");
      assert.equal(sentPayload.transaction.nome, "Cliente Teste");
      assert.equal(sentPayload.transaction.phone, "11999999999");
      assert.equal(sentPayload.transaction.cpf, "12345678901");
      assert.equal(sentPayload.transaction.product_code, "COD1");
      assert.equal(sentPayload.transaction.product_name, "Produto Teste");
      assert.equal(sentPayload.transaction.external_id_client, "CM-TRACKIO1");
      assert.equal(requests[0].options.headers["Content-Type"], "application/json");
      assert.ok(assinaturaValida(requests[0].options.headers["X-ZuckPay-Signature"], sentBody, "trackio-secret"));
      assert.ok(store.atual().trackio?.pagamentoEnviadoEm);
      assert.equal(store.atual().trackioWebhook?.ultimoEvento, "hash-123:paid");
    } finally {
      global.fetch = originalFetch;
      store.restaurar();
    }
  });
});

test("webhook Trackio/Frendz: evento duplicado nao reenvia ao Trackio", async () => {
  await withEnv(TRACKIO_ENV, async () => {
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (url, options) => { requests.push({ url, options }); return { ok: true }; };
    const store = mockStore({
      id: "CM-TRACKIO2", status: "pago", total: 20,
      cliente: { nome: "Cliente Dup", email: "dup@example.invalid" },
      pagamento: { provider: "frendz", providerChargeId: "hash-456" },
      trackioWebhook: { ultimoEvento: "hash-456:paid", recebidoEm: "2026-01-01T00:00:00.000Z" },
      trackio: { pagamentoEnviadoEm: "2026-01-01T00:00:00.000Z" },
    });
    try {
      const handler = getWebhookHandler(freshRouter());
      const payload = {
        transaction: { id: "hash-456", status: "paid", customer: { name: "Cliente Dup", email: "dup@example.invalid" } },
        offer: { hash: "offer-hash" },
      };
      let code;
      await handler({ params: { token: "segredo-valido-da-loja" }, body: payload },
        { sendStatus(status) { code = status; return this; } });
      assert.equal(code, 200);
      assert.equal(requests.length, 0);
    } finally {
      global.fetch = originalFetch;
      store.restaurar();
    }
  });
});

test("webhook Trackio/Frendz: produto desconhecido nao envia ao Trackio", async () => {
  await withEnv(TRACKIO_ENV, async () => {
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (url, options) => { requests.push({ url, options }); return { ok: true }; };
    const store = mockStore({
      id: "CM-TRACKIO3", status: "pago", total: 20,
      cliente: { nome: "Cliente Outro", email: "outro@example.invalid" },
      pagamento: { provider: "frendz", providerChargeId: "hash-789" },
    });
    try {
      const handler = getWebhookHandler(freshRouter());
      const payload = {
        transaction: { id: "hash-789", status: "paid", customer: { name: "Cliente Outro" } },
        offer: { hash: "outro-hash-nao-configurado" },
        items: [{ product_hash: "outro-produto-nao-configurado" }],
      };
      let code;
      await handler({ params: { token: "segredo-valido-da-loja" }, body: payload },
        { sendStatus(status) { code = status; return this; } });
      assert.equal(code, 200);
      assert.equal(requests.length, 0);
      assert.equal(store.atual().trackioWebhook, undefined);
    } finally {
      global.fetch = originalFetch;
      store.restaurar();
    }
  });
});

test("regra 6: pedido sem produto mapeado em TRACKIO_PRODUCTS_JSON nao envia nenhum evento ao Trackio", async () => {
  await withEnv({ ...TRACKIO_ENV, TRACKIO_PRODUCTS_JSON: JSON.stringify({ "outro-produto-sem-relacao": { codigo: "X", nome: "Y" } }) }, async () => {
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (url, options) => { requests.push({ url, options }); return { ok: true }; };
    const store = mockStore({
      id: "CM-TRACKIO5", status: "pendente", total: 10,
      cliente: { nome: "Cliente SemMapa", email: "semmapa@example.invalid" },
      itens: [{ id: PRODUTO_TESTE_ID, quantidade: 1 }],
      pagamento: { provider: "frendz", providerChargeId: "hash-semmapa", copiaECola: "pix-sem-mapa" },
    });
    try {
      // checkout-started: produto do pedido nao esta em TRACKIO_PRODUCTS_JSON.
      await trackio.notificarCheckoutIniciado(store.atual());
      assert.equal(requests.length, 0);
      assert.equal(store.atual().trackio?.checkoutEnviadoEm, undefined);

      // payment_approved: sem produto salvo no checkout-started, tambem nao
      // adivinha pelo hash da Frendz - so ignora com aviso.
      await orderStore.update(store.atual().id, { status: "pago" });
      await trackio.notificarPagamentoAprovado({ ...store.atual(), pagoEm: new Date().toISOString() });
      assert.equal(requests.length, 0);
      assert.equal(store.atual().trackio?.pagamentoEnviadoEm, undefined);
    } finally {
      global.fetch = originalFetch;
      store.restaurar();
    }
  });
});

test("checkout iniciado: envia URL, payload e assinatura reais ao Trackio", async () => {
  await withEnv(TRACKIO_ENV, async () => {
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (url, options) => { requests.push({ url, options }); return { ok: true }; };
    const store = mockStore({
      id: "CM-TRACKIO4", status: "pendente", total: 30,
      cliente: { nome: "Cliente Novo", email: "novo@example.invalid", telefone: "11988887777", cpf: "98765432100" },
      itens: [{ id: PRODUTO_TESTE_ID, quantidade: 1 }],
      pagamento: { provider: "frendz", providerChargeId: "hash-novo", copiaECola: "pix-copia-cola-novo", qrCodeDataUrl: "data:image/png;base64,abc" },
    });
    try {
      await trackio.notificarCheckoutIniciado(store.atual());
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, "https://track-io.example.invalid/api/webhooks/checkout-started/casa-marisol");
      const sentBody = requests[0].options.body;
      const sentPayload = JSON.parse(sentBody);
      assert.equal(sentPayload.checkout.id, "CM-TRACKIO4");
      assert.equal(sentPayload.checkout.email, "novo@example.invalid");
      assert.equal(sentPayload.checkout.nome, "Cliente Novo");
      assert.equal(sentPayload.checkout.phone, "11988887777");
      assert.equal(sentPayload.checkout.cpf, "98765432100");
      assert.equal(sentPayload.checkout.product_code, "COD1");
      assert.equal(sentPayload.checkout.product_name, "Produto Teste");
      assert.equal(sentPayload.checkout.pix_code, "pix-copia-cola-novo");
      // O QR exibido no checkout e uma data URL local: nunca deve ser enviada.
      assert.equal(sentPayload.checkout.pix_qr_code_url, undefined);
      assert.ok(assinaturaValida(requests[0].options.headers["X-ZuckPay-Signature"], sentBody, "trackio-secret"));
      assert.ok(store.atual().trackio?.checkoutEnviadoEm);

      requests.length = 0;
      await trackio.notificarCheckoutIniciado(store.atual());
      assert.equal(requests.length, 0, "nao deve reenviar checkout-started depois de ja enviado");
    } finally {
      global.fetch = originalFetch;
      store.restaurar();
    }
  });
});

test("checkout iniciado: pedido Frendz dispara checkout-started ao Trackio imediatamente", async () => {
  const previous = {
    provider: process.env.PIX_PROVIDER, create: orderStore.create, writable: orderStore.assertWritable,
    createCharge: FrendzPixProvider.prototype.createCharge, notificar: trackio.notificarCheckoutIniciado,
  };
  const product = products.listar().find((p) => p.estoque > 0);
  let capturado;
  process.env.PIX_PROVIDER = "frendz";
  orderStore.assertWritable = async () => {};
  orderStore.create = async (order) => order;
  FrendzPixProvider.prototype.createCharge = async () => ({
    provider: "frendz", transaction_hash: "test-hash", providerChargeId: "test-hash",
    copiaECola: "pix-code-checkout", qrCodeDataUrl: "data:image/png;base64,test", ambiente: "producao",
  });
  trackio.notificarCheckoutIniciado = (pedido) => { capturado = pedido; return Promise.resolve(); };
  try {
    const handler = getPedidosHandler(freshRouter());
    let httpStatus;
    await handler({
      body: {
        cliente: { nome: "Cliente Checkout", email: "checkout@example.invalid", telefone: "11999999999" },
        endereco: {}, itens: [{ id: product.id, quantidade: 1, precoUnitario: 0.01 }], total: 0.01,
      },
    }, { status(code) { httpStatus = code; return this; }, json() { return this; } });
    assert.equal(httpStatus, 201);
    assert.ok(capturado);
    assert.equal(capturado.pagamento.provider, "frendz");
    assert.equal(capturado.pagamento.copiaECola, "pix-code-checkout");
    assert.equal(capturado.cliente.nome, "Cliente Checkout");
  } finally {
    orderStore.create = previous.create;
    orderStore.assertWritable = previous.writable;
    FrendzPixProvider.prototype.createCharge = previous.createCharge;
    trackio.notificarCheckoutIniciado = previous.notificar;
    if (previous.provider === undefined) delete process.env.PIX_PROVIDER;
    else process.env.PIX_PROVIDER = previous.provider;
  }
});
