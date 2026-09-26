// Executar manualmente, somente com autorizacao para criar uma cobranca real.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { buildCharge, FrendzPixProvider } = require("../lib/frendzPixProvider");
const store = require("../lib/orderStore");

async function main() {
  if (!process.argv.includes("--authorized")) throw new Error("Teste real exige --authorized.");
  const token = process.env.FRENDZ_API_TOKEN;
  if (!token) throw new Error("Token ausente.");
  store.assertWritable();
  const id = `CM-TESTE-FRENDZ-${Date.now()}`;
  const cliente = { nome: "Teste Integracao Casa Marisol", email: "teste@example.invalid" };
  const valor = 5; // Minimo confirmado pela resposta HTTP 400 da Frendz.
  const itens = [{ id: "teste-integracao", nome: "Teste de integracao Pix", precoUnitario: valor, quantidade: 1, subtotal: valor }];
  const body = buildCharge({ orderId: id, descricao: `Teste de integracao Pix ${id}`, valor, cliente, itens });
  const folder = path.join(__dirname, "..", ".local", id);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "request.json"), JSON.stringify(body, null, 2));
  const url = new URL("https://api.frendz.com.br/api/public/v1/transactions");
  url.searchParams.set("api_token", token);
  let response;
  try {
    response = await fetch(url, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: "error" });
  } catch (_) {
    throw new Error("Resultado remoto desconhecido: verificar painel antes de repetir o teste.");
  }
  const raw = await response.text();
  // Guarda o corpo sem reformatar; mascara o token apenas se a API o ecoar.
  const safe = raw.replaceAll(token, "[TOKEN REDIGIDO]");
  fs.writeFileSync(path.join(folder, "response.txt"), safe);
  fs.writeFileSync(path.join(folder, "http-status.txt"), String(response.status));
  console.log(`Pedido teste: ${id}\nHTTP ${response.status}\n${safe}\nArquivos: ${folder}`);
  if (!response.ok) { process.exitCode = 1; return; }
  const data = JSON.parse(raw);
  const charge = await new FrendzPixProvider().parseCharge(data.data || data);
  store.create({ id, criadoEm: new Date().toISOString(), cliente, endereco: {}, itens, total: valor,
    status: "pendente", pagamento: charge, testeIntegracao: true });
  console.log("Hash e Pix salvos no pedido de teste. Nenhum pagamento foi realizado.");
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
