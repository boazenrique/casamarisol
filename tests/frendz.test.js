const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { FrendzPixProvider, buildCharge } = require("../lib/frendzPixProvider");
const { getPixProvider } = require("../lib/pixProvider");

const originalFetch = global.fetch;
const originalToken = process.env.FRENDZ_API_TOKEN;
const originalBase = process.env.PUBLIC_BASE_URL;
const originalProduct = process.env.FRENDZ_PRODUCT_HASH;
const originalOffer = process.env.FRENDZ_OFFER_HASH;
beforeEach(() => {
  process.env.FRENDZ_PRODUCT_HASH = "8ldhilcbed";
  process.env.FRENDZ_OFFER_HASH = "y0zsnvpsae";
});
afterEach(() => {
  global.fetch = originalFetch;
  for (const [key, value] of [["FRENDZ_API_TOKEN", originalToken], ["PUBLIC_BASE_URL", originalBase],
    ["FRENDZ_PRODUCT_HASH", originalProduct], ["FRENDZ_OFFER_HASH", originalOffer]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function input() {
  return {
    orderId: "CM-TESTE", valor: 32.3,
    cliente: { nome: "Cliente Teste", email: "teste@example.invalid", cpf: "000.000.000-00", telefone: "(11) 99999-9999" },
    endereco: { rua: "Rua Teste", numero: "1", bairro: "Centro", cidade: "Sao Paulo", uf: "SP", cep: "01001-000" },
    itens: [{ id: "produto::variacao", nome: "Produto local", precoUnitario: 10.1, quantidade: 3 },
      { id: "bump", nome: "Oferta local", precoUnitario: 2, quantidade: 1 }],
    attribution: { utm_source: "facebook", utm_campaign: "campanha" },
  };
}

test("payload Pix agrega o pedido em um item com os hashes exatos e callback da loja", () => {
  process.env.PUBLIC_BASE_URL = "https://loja.example.invalid/";
  const body = buildCharge(input());
  assert.equal(body.amount, 3230);
  assert.deepEqual(body.cart, [{ product_hash: "8ldhilcbed", title: "Pagamento do pedido CM-TESTE - Casa Marisol",
    price: 3230, quantity: 1, operation_type: 1, tangible: false }]);
  assert.equal(body.offer_hash, "y0zsnvpsae");
  assert.equal(body.customer.zip_code, "01001000");
  assert.equal(body.customer.document, "00000000000");
  assert.equal(body.customer.street_name, "Rua Teste");
  assert.equal(body.tracking.utm_source, "facebook");
  assert.equal(body.postback_url, "https://loja.example.invalid/api/webhooks/frendz?pedido=CM-TESTE");
});

test("rejeita valores inconsistentes antes de criar cobranca", () => {
  assert.throws(() => buildCharge({ ...input(), valor: 33 }), /total diferente/);
  assert.throws(() => buildCharge({ ...input(), valor: NaN }), /valor.*invalido/);
  assert.throws(() => buildCharge({ ...input(), cliente: {} }), /cliente incompletos/);
  assert.throws(() => buildCharge({ ...input(), itens: [] }), /carrinho vazio/);
});

test("cria QR local e mantem token somente na chamada ao servidor Frendz", async () => {
  process.env.FRENDZ_API_TOKEN = "segredo-de-teste";
  delete process.env.PUBLIC_BASE_URL;
  global.fetch = async (url, options) => {
    assert.equal(url.origin, "https://api.frendz.com.br");
    assert.equal(url.pathname, "/api/public/v1/transactions");
    assert.equal(url.searchParams.get("api_token"), "segredo-de-teste");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(JSON.parse(options.body).amount, 3230);
    // Fixture provisoria: validar com o exemplo de resposta da conta.
    return { ok: true, json: async () => ({ data: { hash: "hash-teste", pix: { code: "pix-fixture" } } }) };
  };
  const charge = await getPixProvider("frendz").createCharge(input());
  assert.equal(charge.providerChargeId, "hash-teste");
  assert.equal(charge.transaction_hash, "hash-teste");
  assert.equal(charge.provider, "frendz");
  assert.match(charge.qrCodeDataUrl, /^data:image\/png;base64,/);
  assert.equal(JSON.stringify(charge).includes("segredo-de-teste"), false);
});

test("nao inventa identificadores ausentes e nao envia dados pessoais inexistentes", () => {
  process.env.FRENDZ_OFFER_HASH = "";
  assert.throws(() => buildCharge(input()), /nao configurados/);
  process.env.FRENDZ_OFFER_HASH = "y0zsnvpsae";
  process.env.FRENDZ_PRODUCT_HASH = "";
  assert.throws(() => buildCharge(input()), /nao configurados/);
  process.env.FRENDZ_PRODUCT_HASH = "8ldhilcbed";
  const body = buildCharge({ ...input(), cliente: { nome: "Teste", email: "teste@example.invalid" } });
  assert.equal(body.customer.document, undefined);
  assert.equal(body.customer.phone_number, undefined);
});

test("erros de rede e HTTP nao expoem token ou resposta remota", async () => {
  process.env.FRENDZ_API_TOKEN = "segredo-de-teste";
  global.fetch = async () => { throw new Error("https://example.invalid?api_token=segredo-de-teste"); };
  const provider = new FrendzPixProvider();
  await assert.rejects(provider.getStatus({ transactionId: "hash" }), { message: "Frendz: falha de conexao com a API." });
  global.fetch = async () => ({ ok: false, status: 422, json: async () => ({ message: "segredo-de-teste" }) });
  await assert.rejects(provider.getStatus({ transactionId: "hash" }), { message: "Frendz: requisicao recusada (HTTP 422)." });
});

test("consulta confere hash, metodo e valor antes de aceitar pagamento", async () => {
  process.env.FRENDZ_API_TOKEN = "token";
  let transaction = { hash: "hash", payment_method: "pix", amount: 3230, status: "paid" };
  global.fetch = async (url) => {
    assert.equal(url.pathname, "/api/public/v1/transactions/hash");
    return { ok: true, json: async () => ({ data: transaction }) };
  };
  const provider = new FrendzPixProvider();
  const query = { transactionId: "hash", valor: 32.3 };
  assert.equal(await provider.getStatus(query), "pago");
  for (const status of ["pending", "waiting_payment", "processing"]) {
    transaction.status = status;
    assert.equal(await provider.getStatus(query), "pendente");
  }
  transaction.status = "refunded";
  assert.equal(await provider.getStatus(query), "reembolsado");
  transaction.status = "authorized";
  assert.equal(await provider.getStatus(query), null);
  transaction.amount = 1;
  await assert.rejects(provider.getStatus(query), /nao corresponde/);
  transaction.amount = 3230;
  transaction.hash = "outro";
  await assert.rejects(provider.getStatus(query), /nao corresponde/);
  transaction.hash = "hash";
  transaction.payment_method = "credit_card";
  await assert.rejects(provider.getStatus(query), /nao corresponde/);
  assert.equal(await provider.getStatus({}), null);
});

test("nao retorna um Pix incompleto quando resposta de criacao e desconhecida", async () => {
  process.env.FRENDZ_API_TOKEN = "token";
  delete process.env.PUBLIC_BASE_URL;
  global.fetch = async () => ({ ok: true, json: async () => ({ data: { hash: "hash" } }) });
  await assert.rejects(new FrendzPixProvider().createCharge(input()), /Verifique a transacao no painel/);
});
