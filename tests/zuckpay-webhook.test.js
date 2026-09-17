const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ZuckPayPixProvider } = require("../lib/zuckpayPixProvider");

test("Pix sends Dracofy callback directly, preserving order reference and attribution", async () => {
  const names = ["ZUCKPAY_CLIENT_ID", "ZUCKPAY_CLIENT_SECRET", "DRACOFY_WEBHOOK_URL", "PUBLIC_BASE_URL"];
  const previous = names.map((name) => process.env[name]);
  const originalFetch = global.fetch;
  const bodies = [];
  process.env.ZUCKPAY_CLIENT_ID = "test-id";
  process.env.ZUCKPAY_CLIENT_SECRET = "test-secret";
  process.env.PUBLIC_BASE_URL = "https://shop.example.invalid";
  delete process.env.DRACOFY_WEBHOOK_URL;
  global.fetch = async (_, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ transactionId: "test-charge", qrcode: "test-pix" }) };
  };
  try {
    const provider = new ZuckPayPixProvider();
    const charge = { orderId: "test-order", valor: 12.50, cliente: {}, clickId: "test-click",
      attribution: { fbclid: "test-click", fbc: "fb.1.123.test-click", utm_source: "facebook" } };
    const result = await provider.createCharge(charge);
    assert.equal(result.copiaECola, "test-pix");
    assert.equal(bodies[0].urlnoty, "https://api.dracofy.com.br/webhook/pt_4519b7460cba71257c50fe45aca8e57f");
    assert.equal(bodies[0].external_id_client, "test-order");
    assert.equal(bodies[0].click_id, "test-click");
    assert.equal(bodies[0].fbclid, "test-click");
    assert.equal(bodies[0].fbc, "fb.1.123.test-click");
    assert.equal(bodies[0].utm_source, "facebook");
    assert.equal(bodies[0].tracking_params, undefined);
    assert.equal(bodies[0].valor, 12.50);
    process.env.DRACOFY_WEBHOOK_URL = " https://dracofy.example.invalid/webhook/test ";
    await provider.createCharge(charge);
    assert.equal(bodies[1].urlnoty, "https://dracofy.example.invalid/webhook/test");
  } finally {
    global.fetch = originalFetch;
    names.forEach((name, i) => {
      if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i];
    });
  }
});
