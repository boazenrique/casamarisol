/**
 * Gerador de payload Pix (BR Code) no padrão EMV do Banco Central.
 * Usado pelo MockPixProvider para produzir um "copia e cola" e QR Code
 * estruturalmente válidos em ambiente de teste/demonstração.
 *
 * Referência: Manual de Padrões para Iniciação do Pix (Bacen).
 */

function tlv(id, value) {
  const length = String(value.length).padStart(2, "0");
  return `${id}${length}${value}`;
}

function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function normalize(text, maxLength) {
  const normalized = text
    .normalize("NFD")
    .replace(new RegExp("[̀-ͯ]", "g"), "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim();
  return normalized.slice(0, maxLength);
}

/**
 * @param {Object} params
 * @param {string} params.chave - chave Pix do recebedor
 * @param {string} params.nomeRecebedor - nome do beneficiário (max 25)
 * @param {string} params.cidade - cidade do beneficiário (max 15)
 * @param {number} params.valor - valor em reais (ex: 19.90)
 * @param {string} params.txid - identificador da transação (alfanumérico, max 25)
 * @param {string} [params.descricao] - descrição curta opcional
 */
function gerarPayloadPix({ chave, nomeRecebedor, cidade, valor, txid, descricao }) {
  const merchantAccount = [
    tlv("00", "br.gov.bcb.pix"),
    tlv("01", chave),
    descricao ? tlv("02", normalize(descricao, 40)) : "",
  ].join("");

  const additionalData = tlv("05", (txid || "***").slice(0, 25));

  const semCrc = [
    tlv("00", "01"),
    tlv("01", "12"),
    tlv("26", merchantAccount),
    tlv("52", "0000"),
    tlv("53", "986"),
    tlv("54", valor.toFixed(2)),
    tlv("58", "BR"),
    tlv("59", normalize(nomeRecebedor, 25) || "CASA MARISOL"),
    tlv("60", normalize(cidade, 15) || "SAO PAULO"),
    tlv("62", additionalData),
    "6304",
  ].join("");

  return semCrc + crc16(semCrc);
}

module.exports = { gerarPayloadPix, crc16 };
