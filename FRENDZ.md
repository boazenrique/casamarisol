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
- Confirmar armazenamento persistente e compartilhado dos pedidos. O
  `orderStore` atual usa `data/orders.json`, adequado somente a uma instância
  com disco persistente. Discos temporários/serverless e múltiplas instâncias
  exigem migrar esse armazenamento antes de ativar.
- Definir `FRENDZ_API_TOKEN` e `PIX_PROVIDER=frendz` no ambiente do servidor
  e reiniciar a aplicação. Validar também a confirmação de um pagamento real.

## Testes automatizados

`node --test tests/*.test.js`

Usam respostas simuladas, sem token real, sem chamadas de criação em produção.
Cobrem payload, hashes, centavos, QR Code, persistência do identificador,
resposta segura ao frontend e confirmação verificada no backend.
