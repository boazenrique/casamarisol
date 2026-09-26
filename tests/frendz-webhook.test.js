const { test } = require("node:test");
const assert = require("node:assert/strict");
const store = require("../lib/orderStore");
const { FrendzPixProvider } = require("../lib/frendzPixProvider");
const dracofy = require("../lib/dracofy");
const rastreio = require("../lib/rastreioExpress");

test("webhook usa consulta autenticada, recusa outro gateway e permite reentrega em falha", async () => {
  const originals = [store.findById, store.update, FrendzPixProvider.prototype.getStatus,
    dracofy.notificarDracofy, rastreio.processarPedidoAprovado];
  let pedido = { id: "CM-TESTE", status: "pendente", total: 32.3,
    pagamento: { provider: "frendz", providerChargeId: "hash" } };
  let remoteStatus = "pendente";
  let calls = 0;
  const conversions = [];
  store.findById = (id) => id === "CM-TESTE" ? pedido : null;
  store.update = (id, change) => { assert.equal(id, "CM-TESTE"); pedido = { ...pedido, ...change }; return pedido; };
  FrendzPixProvider.prototype.getStatus = async (query) => {
    calls++;
    assert.deepEqual(query, { transactionId: "hash", valor: 32.3 });
    if (remoteStatus === "error") throw new Error("indisponivel");
    return remoteStatus;
  };
  dracofy.notificarDracofy = async (order) => conversions.push(["dracofy", order.status]);
  rastreio.processarPedidoAprovado = async (order) => conversions.push(["rastreio", order.status]);
  const routerPath = require.resolve("../routes/api");
  delete require.cache[routerPath];
  const router = require(routerPath);
  const handler = router.stack.find((entry) => entry.route?.path === "/webhooks/frendz").route.stack[0].handle;
  async function invoke(query = { pedido: "CM-TESTE" }) {
    let code;
    await handler({ query, body: { transaction_hash: "outro", status: "paid", amount: 1 } },
      { sendStatus(status) { code = status; return this; } });
    return code;
  }
  try {
    assert.equal(await invoke(), 200);
    assert.equal(pedido.status, "pendente");
    assert.deepEqual(conversions, []);
    remoteStatus = "pago";
    assert.equal(await invoke(), 200);
    assert.equal(pedido.status, "pago");
    assert.deepEqual(conversions, [["dracofy", "pago"], ["rastreio", "pago"]]);
    assert.equal(await invoke({}), 400);
    assert.equal(await invoke({ pedido: "inexistente" }), 503);
    pedido.pagamento.provider = "zuckpay";
    assert.equal(await invoke(), 400);
    assert.equal(calls, 2);
    pedido.pagamento.provider = "frendz";
    remoteStatus = "error";
    assert.equal(await invoke(), 503);
  } finally {
    [store.findById, store.update, FrendzPixProvider.prototype.getStatus,
      dracofy.notificarDracofy, rastreio.processarPedidoAprovado] = originals;
    delete require.cache[routerPath];
  }
});
