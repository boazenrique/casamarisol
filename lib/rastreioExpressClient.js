"use strict";

// Modulo exclusivo do backend. A credencial nunca e exportada ou registrada.
if (typeof window !== "undefined") {
  throw new Error("Cliente Rastreio Express disponivel somente no backend.");
}

function readApiKey() {
  const value = process.env.RASTREIO_EXPRESS_API_KEY;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Credencial Rastreio Express ausente.");
  }
  // Rejeita caracteres de controle antes de qualquer futuro uso em headers.
  if (/[\x00-\x20\x7f]/.test(value)) {
    throw new Error("Credencial Rastreio Express invalida.");
  }
  return value;
}

// Somente um booleano pode sair desta verificacao; nunca o valor da chave.
function hasCredential() {
  try {
    readApiKey();
    return true;
  } catch {
    return false;
  }
}

// Compatibilidade com o consumidor existente. Ter a chave nao ativa envios.
// Endpoint e esquema de autenticacao devem ser confirmados antes de implementar
// o transporte, que usara readApiKey() internamente, sem exportar headers.
function isConfigured() {
  return false;
}

async function enviarPedido() {
  throw new Error("Integracao Rastreio Express desativada nesta etapa.");
}

module.exports = { hasCredential, isConfigured, enviarPedido };
