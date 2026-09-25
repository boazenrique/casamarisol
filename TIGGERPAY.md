# Pix TiggerPay

No servidor, configure `PIX_PROVIDER=tiggerpay`, `TIGGERPAY_API_KEY` e
`PUBLIC_BASE_URL` (URL publica da loja), e reinicie o processo Node.
A chave fica apenas no `.env`, ignorado pelo Git.

No painel TiggerPay, em Configuracoes > Webhooks, configure
`https://SEU-DOMINIO/api/webhooks/pix`.
O backend confere a venda e seu valor em `/api/vendas` antes de aceitar
a notificacao. Como a entrega nao garante retry, o checkout tambem consulta
`/api/verificar-pix/:txid` a cada 4 segundos enquanto estiver aberto.

A criacao usa `/create-pix-duck`, valor em centavos e os dados do cliente
e endereco. O QR Code e gerado localmente a partir do copia e cola.
Nao e atribuido prazo de expiracao, pois a API nao o informa.

O checkout permite criar e consultar Pix em hospedagem com arquivos somente
leitura. A resposta inclui uma referencia assinada que vincula pedido e txid;
o navegador envia essa referencia na consulta e o servidor valida a assinatura
antes de consultar a TiggerPay. A chave nunca e enviada ao navegador.
Trocar a chave invalida referencias emitidas anteriormente.

Para historico local, processamento de webhook e Rastreio Express, ainda e
necessario armazenamento persistente: o JSON atual serve ao processo unico;
multiplas instancias/serverless precisam de banco compartilhado. Sem esse banco,
o Pix funciona no checkout aberto, mas essas operacoes posteriores nao estao
garantidas e a pagina `/pagamento/:id` depende do registro local.

Na Vercel, configure as variaveis no ambiente do deploy (Production ou Preview)
e gere novo deploy depois de salvar. O `.env` local nao e enviado pelo Git.
Pedidos antigos continuam consultando a ZuckPay; mantenha suas credenciais
enquanto houver pagamentos pendentes nela.

A antiga notificacao direta ZuckPay -> Dracofy nao existe no contrato TiggerPay.
Configure e valide as integracoes de conversao no painel do novo gateway.
Nenhum product_id e inferido dos IDs do catalogo local.
O Rastreio Express depende do pedido salvo ao confirmar o pagamento.

Validacao automatizada: `node --test tests/*.test.js` (APIs simuladas).
Validacao real ainda exige gerar e pagar um Pix e conferir a notificacao
na URL publica. Os testes nao criam cobrancas reais.
