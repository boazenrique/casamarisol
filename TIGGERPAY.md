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

E necessario armazenamento persistente e gravavel de `data/orders.json`:
a TiggerPay consulta por txid, sem busca documentada pelo ID interno do pedido.
O armazenamento atual em JSON e adequado apenas ao processo unico existente;
para multiplas instancias/serverless, migrar para banco compartilhado antes de usar.
Pedidos antigos continuam consultando a ZuckPay; mantenha suas credenciais
enquanto houver pagamentos pendentes nela.

A antiga notificacao direta ZuckPay -> Dracofy nao existe no contrato TiggerPay.
Configure e valide as integracoes de conversao no painel do novo gateway.
Nenhum product_id e inferido dos IDs do catalogo local.
O Rastreio Express continua sendo acionado pela confirmacao do pagamento.

Validacao automatizada: `node --test tests/*.test.js` (APIs simuladas).
Validacao real ainda exige gerar e pagar um Pix e conferir a notificacao
na URL publica. Os testes nao criam cobrancas reais.
