const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TiggerPayPixProvider } = require("../lib/tiggerpayPixProvider");

test("TiggerPay: contrato de criacao, status e validacao de webhook", async () => {
  const originalFetch = global.fetch;
  const previousKey = process.env.TIGGERPAY_API_KEY;
  process.env.TIGGERPAY_API_KEY = "test-key";
  const provider = new TiggerPayPixProvider();
  const calls = [];
  let response = { txid: "abc/123", pix_qr_code: "000201-test-pix" };
  let ok = true;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok, status: ok ? 200 : 401, json: async () => response };
  };
  try {
    const charge = await provider.createCharge({ valor: 19.90, descricao: "Pedido teste",
      cliente: { nome: "Teste", email: "teste@example.invalid", cpf: "123.456.789-00", telefone: "(11) 99999-9999" },
      endereco: { cep: "01310-100", rua: "Paulista", numero: "1000", cidade: "Sao Paulo", uf: "SP" } });
    assert.equal(calls[0].url, "https://api.tiggerpayments.com/create-pix-duck");
    assert.equal(calls[0].options.headers["x-api-key"], "test-key");
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.amount, 1990);
    assert.equal(body.customer.taxId, "12345678900");
    assert.equal(body.customer.cellphone, "11999999999");
    assert.equal(body.customer.address.street, "Paulista");
    assert.equal(body.api_key, undefined);
    assert.equal(charge.providerChargeId, "abc/123");
    assert.match(charge.qrCodeDataUrl, /^data:image\/png;base64,/);
    assert.equal(charge.expiraEm, undefined);
    for (const [remote, expected] of [["approved", "pago"], ["pendente", "pendente"], ["refused", null]]) {
      response = { status: remote };
      assert.equal(await provider.getStatus({ transactionId: "abc/123" }), expected);
      assert.match(calls.at(-1).url, /verificar-pix\/abc%2F123$/);
    }
    response = [{ txid: "abc/123", status: "approved", valor: 19.90 }];
    assert.equal(await provider.verifyPaidSale("abc/123", 19.90), true);
    assert.equal(await provider.verifyPaidSale("abc/123", 20), false);
    assert.equal(await provider.verifyPaidSale("other", 19.90), false);
    response[0].status = "pendente";
    assert.equal(await provider.verifyPaidSale("abc/123", 19.90), false);
    response = {};
    await assert.rejects(provider.createCharge({ valor: 10, cliente: { nome: "a", email: "b" } }), /sem txid/);
    ok = false;
    await assert.rejects(provider.getStatus({ transactionId: "abc" }), /HTTP 401/);
    delete process.env.TIGGERPAY_API_KEY;
    await assert.rejects(provider.getStatus({ transactionId: "abc" }), /nao configurada/);
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.TIGGERPAY_API_KEY;
    else process.env.TIGGERPAY_API_KEY = previousKey;
  }
});
