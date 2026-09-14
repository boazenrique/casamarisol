const ENDPOINT_URL = "https://rastreioexpreess.lovable.app/api/public/pedidos";

/**
 * Cliente HTTP puro para o Rastreio Express. A API key vive somente em
 * process.env.RASTREIO_EXPRESS_API_KEY (arquivo .env, nunca commitado — ver
 * .gitignore) e nunca deve ser lida no frontend, logada ou incluída em
 * respostas da API voltadas ao cliente.
 *
 * A lógica de negócio (quando enviar, idempotência, seleção do produto
 * principal) fica em lib/rastreioExpress.js — este arquivo só sabe falar
 * com a API externa.
 *
 * *** CONTRATO NÃO CONFIRMADO ***
 * O header de autenticação (Bearer) e o formato do payload (ver
 * montarPayload em lib/rastreioExpress.js) são uma SUPOSIÇÃO baseada em
 * convenção de mercado — não há, neste ambiente, documentação oficial nem
 * outra integração de referência do Rastreio Express para validar contra.
 * Não trate esta integração como pronta para produção até confirmar com a
 * documentação/suporte do Rastreio Express: (1) qual header de auth eles
 * realmente esperam, (2) os nomes de campos exatos do payload, (3) o
 * formato de endereço aceito. Ajustar authHeaders() e montarPayload() assim
 * que houver confirmação.
 */
function isConfigured() {
  return process.env.RASTREIO_EXPRESS_ENABLED === "true" &&
    Boolean(process.env.RASTREIO_EXPRESS_API_KEY?.trim());
}

function authHeaders() {
  const apiKey = process.env.RASTREIO_EXPRESS_API_KEY;
  if (!apiKey) {
    throw new Error("RASTREIO_EXPRESS_API_KEY não configurada.");
  }
  // Esquema Bearer por ser o padrão de mercado; ajustar aqui caso a
  // documentação do Rastreio Express especifique outro formato de header.
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

async function enviarPedido(payload) {
  if (!isConfigured()) {
    throw new Error("Integracao Rastreio Express desativada ou sem credencial.");
  }
  console.warn(
    "Aviso: enviando pedido ao Rastreio Express com contrato (auth/payload) ainda NÃO CONFIRMADO pela documentação oficial — ver comentário no topo de lib/rastreioExpressClient.js."
  );
  const resp = await fetch(ENDPOINT_URL, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    // Nunca incluir a API key ou os headers da requisição na mensagem de erro.
    throw new Error(`Rastreio Express: falha ao enviar pedido (HTTP ${resp.status})`);
  }
  return data;
}

module.exports = { isConfigured, enviarPedido };
