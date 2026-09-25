const { test } = require("node:test");
const assert = require("node:assert/strict");
const store = require("../lib/orderStore");
const router = require("../routes/api");
const products = require("../lib/products");
const { readReference } = require("../lib/pixReference");

function handler(path, method) {
  return router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]).route.stack.at(-1).handle;
}
function response() {
  return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

test("Pix cria e consulta em outra instancia com armazenamento somente leitura", async () => {
  const original = { fetch: global.fetch, create: store.create, find: store.findById,
    key: process.env.TIGGERPAY_API_KEY, provider: process.env.PIX_PROVIDER };
  process.env.TIGGERPAY_API_KEY = "serverless-test-secret";
  process.env.PIX_PROVIDER = "tiggerpay";
  store.create = () => { throw new Error("EROFS: read-only file system"); };
  store.findById = () => null;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => url.endsWith("/create-pix-duck")
      ? { txid: "test-transaction", pix_code: "000201-test-pix" } : { status: "approved" } };
  };
  try {
    const product = products.listar().find((p) => p.estoque > 0);
    const created = response();
    await handler("/pedidos", "post")({ body: {
      cliente: { nome: "Teste", email: "teste@example.invalid", telefone: "11999999999" },
      itens: [{ id: product.id, quantidade: 1 }],
    } }, created);
    assert.equal(created.code, 201);
    assert.match(created.body.pagamento.qrCodeDataUrl, /^data:image\/png/);
    const token = created.body.referenciaPix;
    const id = created.body.id;
    assert.equal(readReference(token, id), "test-transaction");
    assert.equal(JSON.stringify(created.body).includes(process.env.TIGGERPAY_API_KEY), false);
    const status = response();
    await handler("/pedidos/:id/status", "get")({ params: { id }, query: { referencia: token } }, status);
    assert.equal(status.body.status, "pago");
    assert.equal(calls.at(-1), "https://api.tiggerpayments.com/api/verificar-pix/test-transaction");
    assert.equal(readReference(token, "another-order"), null);
    const tampered = Buffer.from(JSON.stringify({ orderId: id, transactionId: "other" })).toString("base64url") + "." + token.split(".")[1];
    const invalid = response();
    const callCount = calls.length;
    await handler("/pedidos/:id/status", "get")({ params: { id }, query: { referencia: tampered } }, invalid);
    assert.equal(invalid.code, 400);
    assert.equal(calls.length, callCount);
  } finally {
    global.fetch = original.fetch;
    store.create = original.create;
    store.findById = original.find;
    for (const [name, value] of [["TIGGERPAY_API_KEY", original.key], ["PIX_PROVIDER", original.provider]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
