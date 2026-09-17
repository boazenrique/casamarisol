const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeAttribution } = require("../lib/attribution");
const source = fs.readFileSync(path.join(__dirname, "../public/js/attribution.js"), "utf8");

function page(search, storage, cookie = "", DTrack) {
  const context = { window: { DTrack }, location: { search }, document: { cookie }, sessionStorage: storage, URLSearchParams };
  vm.runInNewContext(source, context);
  return context.window.CasaMarisolAttribution.collect();
}

test("preserves attribution from landing page through checkout without SDK", () => {
  let value;
  const storage = { getItem: () => value, setItem: (_, next) => { value = next; } };
  page("?click_id=abc&utm_source=facebook&utm_campaign=launch&fbclid=meta123", storage);
  const checkout = page("", storage);
  assert.equal(checkout.click_id, "abc");
  assert.equal(checkout.utm_campaign, "launch");
  assert.match(checkout.fbc, /^fb\.1\.\d+\.meta123$/);
  const next = page("?utm_source=google", storage);
  assert.equal(next.click_id, undefined);
  assert.equal(next.utm_campaign, undefined);
});

test("Meta click survives navigation before SDK loads", () => {
  let value;
  const storage = { getItem: () => value, setItem: (_, next) => { value = next; } };
  page("?fbclid=meta-click", storage);
  const checkout = page("", storage);
  assert.equal(checkout.click_id, "meta-click");
  assert.equal(checkout.fbclid, "meta-click");
  assert.equal(normalizeAttribution(checkout).fbclid, "meta-click");
});

test("SDK supplies click captured on an earlier visit", () => {
  const result = page("", { getItem: () => null, setItem() {} }, "", { getClickId: () => "sdk-click" });
  assert.equal(result.click_id, "sdk-click");
});

test("blocked storage and broken SDK do not break checkout; cookies still work", () => {
  const blocked = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  const result = page("?utm_source=facebook", blocked, "_fbc=fb.1.123.abc; _fbp=browser", { getClickId() { throw Error(); } });
  assert.equal(result.fbc, "fb.1.123.abc");
  assert.equal(result.fbp, "browser");
});

test("accepts legacy click IDs and rejects unexpected input", () => {
  assert.deepEqual(normalizeAttribution({ utm_source: " ads ", fbc: {}, extra: "no" }, " old "), { utm_source: "ads", click_id: "old" });
});

test("Dracofy sends UTM-only orders, retries failures and skips successful duplicates", async () => {
  const store = require("../lib/orderStore");
  const original = { findById: store.findById, update: store.update, fetch: global.fetch };
  let order = { id: "test-only", status: "pago", total: 10, attribution: { utm_source: "facebook" } };
  let calls = 0;
  store.findById = () => order;
  store.update = (_, changes) => (order = { ...order, ...changes });
  global.fetch = async (_, options) => {
    calls++;
    const body = JSON.parse(options.body);
    assert.equal(body.utm_source, "facebook");
    assert.equal(body.external_id, order.id);
    return { ok: calls > 1, status: calls === 1 ? 503 : 200 };
  };
  try {
    const { notificarDracofy } = require("../lib/dracofy");
    await notificarDracofy(order);
    assert.equal(order.dracofy.status, "falhou");
    order.dracofy.tentadoEm = new Date(Date.now() - 31000).toISOString();
    await Promise.all([notificarDracofy(order), notificarDracofy(order)]);
    assert.equal(order.dracofy.status, "enviado");
    await notificarDracofy(order);
    assert.equal(calls, 2);
    order = { id: "organic", status: "pago", attribution: {} };
    await notificarDracofy(order);
    assert.equal(order.dracofy.status, "sem_atribuicao");
    assert.equal(calls, 2);
  } finally {
    store.findById = original.findById;
    store.update = original.update;
    global.fetch = original.fetch;
  }
});
