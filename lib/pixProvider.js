const QRCode = require("qrcode");
const { gerarPayloadPix } = require("./pixBrCode");
const { ZuckPayPixProvider } = require("./zuckpayPixProvider");

const RECEBEDOR = {
  nome: process.env.PIX_NOME_RECEBEDOR || "Casa Marisol",
  cidade: process.env.PIX_CIDADE_RECEBEDOR || "Sao Paulo",
  chave: process.env.PIX_CHAVE || "chave-de-teste@casamarisol.com.br",
};

/**
 * Provider de demonstração: gera um BR Code Pix válido no formato, mas
 * apontando para uma chave de teste. Não movimenta dinheiro real.
 * A confirmação de pagamento é feita manualmente pelo botão
 * "Simular confirmação" na página de pagamento (equivalente ao webhook
 * que um provedor real enviaria automaticamente).
 */
class MockPixProvider {
  async createCharge({ orderId, valor, descricao }) {
    const txid = orderId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 25) || "PEDIDO";
    const copiaECola = gerarPayloadPix({
      chave: RECEBEDOR.chave,
      nomeRecebedor: RECEBEDOR.nome,
      cidade: RECEBEDOR.cidade,
      valor,
      txid,
      descricao,
    });
    const qrCodeDataUrl = await QRCode.toDataURL(copiaECola, { margin: 1, width: 280 });

    return {
      providerChargeId: `mock_${txid}_${Date.now()}`,
      copiaECola,
      qrCodeDataUrl,
      expiraEm: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      ambiente: "teste",
    };
  }

  // No provider mock, o status vive no próprio pedido (orderStore).
  // Providers reais devem consultar a API do gateway aqui.
  async getStatus() {
    return null;
  }
}

function getPixProvider() {
  const tipo = (process.env.PIX_PROVIDER || "mock").toLowerCase();
  switch (tipo) {
    case "zuckpay":
      return new ZuckPayPixProvider();
    case "mock":
    default:
      return new MockPixProvider();
  }
}

module.exports = { getPixProvider, MockPixProvider, ZuckPayPixProvider };
