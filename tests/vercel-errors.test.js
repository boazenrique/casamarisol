const { test } = require("node:test");
const assert = require("node:assert/strict");
const store = require("../lib/orderStore");
const { FrendzPixProvider } = require("../lib/frendzPixProvider");
const products = require("../lib/products");
const router = require("../routes/api");
const create = router.stack.find((x) => x.route?.path === "/pedidos").route.stack[0].handle;
const status = router.stack.find((x) => x.route?.path === "/pedidos/:id/status").route.stack[0].handle;

function response() {
  return { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

test("Vercel sem banco retorna 503 identificavel sem criar cobranca nem falso 404", async () => {
  const keys = ["VERCEL", "DATABASE_URL", "POSTGRES_URL", "PIX_PROVIDER"];
  const previous = keys.map((key) => process.env[key]);
  const original = FrendzPixProvider.prototype.createCharge;
  const errorLog = console.error;
  let called = false;
  console.error = () => {};
  process.env.VERCEL = "1";
  process.env.PIX_PROVIDER = "frendz";
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  FrendzPixProvider.prototype.createCharge = async () => { called = true; };
  try {
    assert.throws(() => store.assertWritable(), { code: "ORDER_STORAGE_NOT_CONFIGURED" });
    const res = response();
    await create({ body: { cliente: { nome: "Teste", email: "teste@example.invalid", telefone: "11999999999" },
      itens: [{ id: products.listar().find((p) => p.estoque > 0).id, quantidade: 1 }] } }, res);
    assert.equal(res.code, 503);
    assert.equal(res.body.codigo, "ORDER_STORAGE_NOT_CONFIGURED");
    assert.match(res.body.referencia, /^[a-f0-9-]{36}$/);
    assert.equal(called, false);
    const poll = response();
    await status({ params: { id: "CM-TESTE" } }, poll);
    assert.equal(poll.code, 503);
    assert.equal(poll.body.codigo, "ORDER_STORAGE_ERROR");
  } finally {
    keys.forEach((key, i) => previous[i] === undefined ? delete process.env[key] : process.env[key] = previous[i]);
    FrendzPixProvider.prototype.createCharge = original;
    console.error = errorLog;
  }
});
