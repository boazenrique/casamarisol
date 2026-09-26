# Integração Pix Frendz

## Estado atual

A implementação usa os identificadores fornecidos pelo responsável da loja:

- `FRENDZ_PRODUCT_HASH=8ldhilcbed`
- `FRENDZ_OFFER_HASH=y0zsnvpsae`
- `PUBLIC_BASE_URL=https://www.casamarisolshop.com.br`

O token permanece no `.env` do backend, ignorado pelo Git. O checkout não
redireciona para a oferta: recebe código Pix e QR Code gerado localmente.

A Frendz foi selecionada como provedor padrão no código e no `.env` local,
por solicitação explícita para testar o projeto publicado mesmo após os erros
dos testes reais. O servidor precisa de `FRENDZ_API_TOKEN` no ambiente e, se
houver `PIX_PROVIDER=zuckpay` configurado, alterá-lo para `frendz` e reiniciar.
O `.env` e o token não são enviados pelo Git. Os hashes e domínio informados
são os padrões do backend, com possibilidade de sobrescrita por variáveis.

## Contrato implementado

`POST https://api.frendz.com.br/api/public/v1/transactions`, autenticado com
`api_token` exclusivamente na chamada do servidor. Não registrar a URL com token.

O payload envia `amount` em centavos, `offer_hash`, `payment_method=pix`,
os dados do comprador e um único item em `cart`: `product_hash`, título do
pagamento, `price` igual ao total em centavos, `quantity=1`, `operation_type=1`
e `tangible=false`. Os itens reais e seus preços continuam no pedido local.
O total é calculado pelo backend a partir do catálogo, não pelo navegador.

O postback enviado é:
`https://www.casamarisolshop.com.br/api/webhooks/frendz?pedido=<id-local>`.
O backend consulta `GET /transactions/{hash}` e confere hash, valor e método
Pix antes de marcar como pago. Somente `paid` libera o processamento posterior.
O polling do checkout consulta a mesma API como fallback. Testes de integração
identificados como tais não acionam conversões nem rastreio.

O identificador remoto fica salvo em `pagamento.transaction_hash` e
`pagamento.providerChargeId`. O parser aceita `hash` ou `transaction_hash`,
`pix.code`, `pix.expires_at`, `amount`, `payment_method`/`method` e `status`,
diretamente ou sob `data`. **A resposta de sucesso ainda precisa ser validada
com uma transação real**, pois a Frendz retornou erros nos testes autorizados.

## Testes reais em 26/09/2026

Usados exatamente os hashes acima, nome de teste e e-mail reservado
`teste@example.invalid`. Não foram fornecidos CPF ou telefone reais; o usuário
orientou que não fossem solicitados dados pessoais adicionais.

1. R$ 1,00: HTTP 400, corpo exato:

```json
{"success":false,"message":"O valor da compra precisa ser no m\u00ednimo 5,00 reais"}
```

2. R$ 5,00: HTTP 400, corpo exato:

```json
{"success":false,"message":"Ocorreu um erro ao tentar processar o pagamento."}
```

A API não apontou um hash inválido nem identificou a causa do segundo erro.
Não é possível concluir se a causa são dados do teste, configuração da conta,
identificadores ou processamento do gateway. Nenhum identificador foi trocado.
A consulta posterior `GET /transactions` retornou HTTP 200, `total=0`, `data=[]`.
Nenhum Pix foi pago e nenhuma transação ficou registrada nessa consulta.

Requisições sem token e respostas integrais estão em `.local/`, ignorado pelo
Git, nas pastas `CM-TESTE-FRENDZ-1790460157681` e
`CM-TESTE-FRENDZ-1790460187111`. O script `scripts/frendz-live-test.js` é manual,
cria uma cobrança real e exige o argumento `--authorized`; não faz parte dos
testes automatizados e não deve ser repetido automaticamente após erro de rede.

## Pendências no ambiente publicado

- Resolver com a Frendz o erro de processamento HTTP 400 e obter uma resposta
  de criação bem-sucedida; validar os campos usados pelo parser.
- Publicar o backend no domínio informado para receber o postback.
- Conectar Postgres ao projeto Vercel e disponibilizar `DATABASE_URL` ou
  `POSTGRES_URL`. O backend cria a tabela `casa_marisol_orders` na primeira
  conexão (a credencial precisa de permissão para criá-la). Fora da Vercel,
  sem banco configurado, o armazenamento local em `data/orders.json` continua.
  Pedidos existentes nesse JSON não são importados automaticamente no banco.
- Definir `FRENDZ_API_TOKEN` e `PIX_PROVIDER=frendz` no ambiente do servidor
  e reiniciar a aplicação. Validar também a confirmação de um pagamento real.

## Testes automatizados

`node --test tests/*.test.js`

Usam respostas simuladas, sem token real, sem chamadas de criação em produção.
Cobrem payload, hashes, centavos, QR Code, persistência do identificador,
resposta segura ao frontend e confirmação verificada no backend.

## Correção para Vercel e diagnóstico

O filesystem da aplicação na Vercel é somente leitura. O antigo teste de escrita
antes de chamar a Frendz podia encerrar a criação do pedido com HTTP 500.
Agora a Vercel exige Postgres e todas as operações de pedidos aguardam o banco.
As confirmações usam trava transacional por pedido para serializar os efeitos
entre instâncias. O teste SQL usa PostgreSQL embarcado (PGlite); a conexão com
o banco do projeto só pode ser validada depois de configurar a variável.

Para configurar: Vercel → projeto → Storage/Marketplace → Neon/Postgres →
conectar ao projeto em Production. Confirme `DATABASE_URL` nas variáveis de
ambiente, mantenha `FRENDZ_API_TOKEN` e `PIX_PROVIDER=frendz`, e faça Redeploy.
Não use prefixos públicos para credenciais.

`POST /api/pedidos` retorna uma referência que também aparece nos logs, sem
gravar token ou dados do comprador. Códigos relevantes:

- `ORDER_STORAGE_NOT_CONFIGURED` (503): falta a conexão Postgres na Vercel.
- `ORDER_STORAGE_ERROR` (503): falha de conexão, esquema ou gravação do pedido.
- `FRENDZ_NOT_CONFIGURED` (503): falta o token no ambiente do servidor.
- `FRENDZ_HTTP_ERROR` (502): a API Frendz recusou a requisição; o HTTP de origem
  aparece como `providerStatus` nos logs.
- `FRENDZ_NETWORK_ERROR` (502): não foi possível concluir a chamada à Frendz.

Falhas no banco durante consulta não viram mais "pedido não encontrado" (404).
`/favicon.ico` redireciona para o ícone PNG existente. A URL do outro 404
relatado pelo usuário precisa ser confirmada se não for o favicon.
