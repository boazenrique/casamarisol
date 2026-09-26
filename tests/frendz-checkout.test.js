const { test } = require("node:test");
const assert = require("node:assert/strict");
const store = require("../lib/orderStore");
const products = require("../lib/products");
const { FrendzPixProvider } = require("../lib/frendzPixProvider");

test("checkout conserva itens locais, salva transaction_hash e responde apenas com Pix local", async () => {
  const previous = { provider: process.env.PIX_PROVIDER, create: store.create, writable: store.assertWritable,
    createCharge: FrendzPixProvider.prototype.createCharge };
  const product = products.listar().find((p) => p.estoque > 0);
  let saved;
  let writeChecked = false;
  process.env.PIX_PROVIDER = "frendz";
  store.assertWritable = () => { writeChecked = true; };
  store.create = (order) => { saved = order; return order; };
  FrendzPixProvider.prototype.createCharge = async (input) => {
    assert.equal(writeChecked, true);
    assert.equal(input.valor, Number(product.precoPix));
    assert.equal(input.itens[0].id, product.id);
    assert.equal(input.itens[0].precoUnitario, product.precoPix);
    return { provider: "frendz", transaction_hash: "test-hash", providerChargeId: "test-hash",
      copiaECola: "pix-code", qrCodeDataUrl: "data:image/png;base64,test", ambiente: "producao" };
  };
  const router = require("../routes/api");
  const handler = router.stack.find((entry) => entry.route?.path === "/pedidos").route.stack[0].handle;
  let httpStatus, response;
  try {
    await handler({ body: {
      cliente: { nome: "Teste", email: "teste@example.invalid", telefone: "11999999999" },
      endereco: {}, itens: [{ id: product.id, quantidade: 1, precoUnitario: 0.01 }], total: 0.01,
    } }, {
      status(code) { httpStatus = code; return this; }, json(body) { response = body; return this; },
    });
    assert.equal(httpStatus, 201);
    assert.equal(saved.pagamento.transaction_hash, "test-hash");
    assert.equal(saved.status, "pendente");
    assert.equal(saved.itens[0].id, product.id);
    assert.equal(response.total, Number(product.precoPix));
    assert.equal(response.pagamento.copiaECola, "pix-code");
    assert.deepEqual(Object.keys(response.pagamento).sort(),
      ["ambiente", "copiaECola", "expiraEm", "qrCodeDataUrl", "tipo"].sort());
    assert.equal(JSON.stringify(response).includes("go.frendz.com.br"), false);
  } finally {
    store.create = previous.create;
    store.assertWritable = previous.writable;
    FrendzPixProvider.prototype.createCharge = previous.createCharge;
    if (previous.provider === undefined) delete process.env.PIX_PROVIDER;
    else process.env.PIX_PROVIDER = previous.provider;
  }
});
