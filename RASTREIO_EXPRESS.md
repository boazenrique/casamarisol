# Preparacao da credencial do Rastreio Express

A unica fonte da credencial e process.env.RASTREIO_EXPRESS_API_KEY.
O dotenv ja carrega o arquivo .env no backend em server.js; esse arquivo e
ignorado pelo Git. Esta etapa nao modifica a credencial nem o arquivo .env.

lib/rastreioExpressClient.js mantem a leitura e validacao da chave em uma
funcao privada. hasCredential() retorna somente um booleano. Nenhuma funcao
exporta a chave ou headers de autenticacao. O modulo rejeita execucao no browser
 e fica fora da pasta public, unica pasta de arquivos estaticos do servidor.

A integracao permanece bloqueada no proprio cliente: isConfigured() retorna
false e enviarPedido() rejeita sem acessar a rede, mesmo que alguma flag externa
seja ativada. O endpoint presumido e o transporte HTTP foram removidos.

Para uma etapa futura autorizada, confirmar dominio, endpoint e esquema de
autenticacao oficiais antes de implementar o transporte usando a leitura privada.
Nao presumir Bearer ou outro header. Nao encaminhar respostas ou erros externos
sem tratamento, nem registrar credenciais. A autenticacao remota nao foi testada.

Esta etapa nao altera routes/api.js, lib/rastreioExpress.js, checkout, gateway,
webhook, confirmacao de pagamento, precos, layout ou fluxo de pagamento.
As chamadas preexistentes ao cliente permanecem inativas. Nao foi feita publicacao
nem configuracao de secrets na hospedagem.
