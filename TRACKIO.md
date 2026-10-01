# Integração Trackio (via Frendz)

## O que isso faz

1. Ao criar o checkout/Pix (Frendz), o backend envia o evento
   `checkout-started` ao Trackio imediatamente, com nome, e-mail, telefone,
   CPF (se disponível), produto, ID do checkout e o código Pix copia-e-cola.
2. Quando a Frendz confirma o pagamento (`status: "paid"`), o backend envia
   `payment-approved` ao Trackio.
3. Um checkout que já foi marcado como pago nunca recebe `checkout-started`
   de novo (`lib/trackio.js` confere o status e a flag `trackio.checkoutEnviadoEm`
   antes de enviar).
4. Nenhum segredo (`TRACKIO_WEBHOOK_SECRET`, `FRENDZ_WEBHOOK_TOKEN`,
   `FRENDZ_API_TOKEN`) é enviado ao navegador, logado ou commitado — todos
   ficam só no `.env` do servidor (`.gitignore` já ignora `.env*` exceto
   `.env.example`).

## Contrato real do Trackio

`lib/trackio.js` implementa exatamente os dois endpoints confirmados pelo
responsável da loja:

### 1. Checkout iniciado

```
POST {TRACKIO_ORIGIN}/api/webhooks/checkout-started/{TRACKIO_STORE_SLUG}
```

```json
{
  "checkout": {
    "id": "CM-...",
    "email": "...",
    "nome": "...",
    "phone": "...",
    "cpf": "...",
    "product_code": "<codigo Trackio do produto real do pedido>",
    "product_name": "<nome completo do produto real do pedido>",
    "checkout_url": "...",
    "pix_code": "...",
    "pix_qr_code_url": "..."
  }
}
```

### 2. Pagamento aprovado

```
POST {TRACKIO_ORIGIN}/api/webhooks/zuckpay/{TRACKIO_STORE_SLUG}
```

(esse é o endpoint genérico do Trackio no formato do webhook da ZuckPay —
usado também para repassar pagamentos de outros gateways, incluindo a
Frendz.)

```json
{
  "event": "payment_approved",
  "transaction": {
    "id": "<hash da transação na Frendz>",
    "status": "PAID",
    "confirmed_date": "...",
    "email": "...",
    "nome": "...",
    "phone": "...",
    "cpf": "...",
    "product_code": "<codigo Trackio do produto real do pedido>",
    "product_name": "<nome completo do produto real do pedido>",
    "external_id_client": "CM-... (id local do pedido)"
  }
}
```

### Assinatura (os dois endpoints)

1. O corpo é serializado em JSON **uma única vez** — a mesma string é
   assinada e enviada (`post()` em `lib/trackio.js`).
2. `timestamp` = Unix em segundos no momento do envio.
3. `hmac` = HMAC-SHA256 de `"{timestamp}.{rawJson}"`, usando
   `TRACKIO_WEBHOOK_SECRET` como chave, em hexadecimal.
4. Header enviado: `X-ZuckPay-Signature: t={timestamp},v1={hmac}`.
5. `Content-Type: application/json`.

### Observações sobre os campos

- **Identificação do produto real.** A Frendz reutiliza o **mesmo**
  `FRENDZ_OFFER_HASH`/`FRENDZ_PRODUCT_HASH` para os 8 produtos desta loja —
  por isso eles nunca identificam qual item foi comprado, só servem de
  whitelist de origem do webhook (regra 7). `product_code`/`product_name`
  vêm do **pedido local**:
  1. O produto principal do pedido é o primeiro item de `pedido.itens` que
     não é order bump (`idProdutoPrincipal()` em `lib/trackio.js`, usando o
     catálogo de `lib/products.js`).
  2. Esse id local é procurado em `TRACKIO_PRODUCTS_JSON` (ver variáveis de
     ambiente abaixo), que mapeia `id do catálogo -> { codigo, nome }`.
  3. O resultado é salvo em `pedido.trackio.{produtoLocalId,produtoCodigo,produtoNome}`
     já no `checkout-started`. O `payment_approved` **reutiliza esse valor
     salvo** em vez de recalcular (regra 4) — só recalcula pelo carrinho
     local se o pedido não tiver passado por um `checkout-started` com
     produto resolvido, e nunca pelo hash da Frendz.
  4. Se o produto do pedido não estiver em `TRACKIO_PRODUCTS_JSON`, **nenhum
     evento é enviado** ao Trackio (nem checkout-started, nem
     payment_approved) — só um aviso no log (`console.warn`), para nunca
     mandar um produto errado/adivinhado (regra 6).
- `pix_qr_code_url` e `checkout_url` só são enviados se forem URLs públicas
  HTTPS (`urlPublicaHttps()` em `lib/trackio.js`). O QR exibido no checkout
  desta loja é gerado localmente como `data:image/...;base64,...`
  (`lib/frendzPixProvider.js`) — isso **nunca** é enviado como
  `pix_qr_code_url`. Hoje nenhum dos dois campos tem fonte de dados
  disponível no pedido local, então saem omitidos do payload; se a Frendz
  passar a expor uma URL pública de checkout/QR, popule
  `pedido.pagamento.checkoutUrl` / `pedido.pagamento.qrCodeUrl` (fora de
  `lib/trackio.js`) para que passem a ser enviados automaticamente.
- `payment_approved` só é enviado quando a confirmação de pagamento for
  real: `status === "paid"` revalidado pela API autenticada da Frendz
  (fluxo já existente em `/api/webhooks/frendz` e no polling de status) ou,
  na rota dedicada abaixo, pelo payload do próprio webhook da Frendz.

## Variáveis de ambiente

Adicionadas em `.env.example` (preencha os valores reais só no `.env` local
ou nas variáveis de ambiente do servidor/Vercel — nunca no Git):

```env
TRACKIO_ORIGIN=https://track-io.site
TRACKIO_STORE_SLUG=casa-marisol
TRACKIO_WEBHOOK_SECRET=preencher-depois
FRENDZ_WEBHOOK_TOKEN=preencher-depois
FRENDZ_OFFER_HASH=y0zsnvpsae
FRENDZ_PRODUCT_HASH=8ldhilcbed
TRACKIO_PRODUCTS_JSON=preencher-com-mapeamento-dos-produtos
```

`FRENDZ_OFFER_HASH`/`FRENDZ_PRODUCT_HASH` já existiam (ver `FRENDZ.md`).
Agora eles têm dois papéis bem separados:

- No webhook `/api/frendz/webhook/:token`: continuam servindo **só de
  whitelist** — confirmam que o evento é da oferta/produto cadastrados
  nesta loja na Frendz, nunca para dizer qual item foi comprado (regra 7).
- No Trackio: **não são usados para nada** — quem identifica o produto é
  `TRACKIO_PRODUCTS_JSON` (abaixo), lido a partir do pedido local.

`TRACKIO_PRODUCTS_JSON` é um objeto JSON em uma única linha, mapeando o
**id do produto no catálogo local** (`data/products.json` / `lib/products.js`,
o mesmo valor usado em `pedido.itens[].id`) para o código e nome que devem
ir ao Trackio:

```json
{
  "<id-do-produto-no-catalogo>": { "codigo": "<codigo no Trackio>", "nome": "<nome completo exibido ao cliente>" },
  "...": { "codigo": "...", "nome": "..." }
}
```

O `.env.example` já vem com uma sugestão completa para os 8 produtos
cadastrados hoje. Ajuste os códigos para os que você cadastrar no painel
do Trackio; se adicionar um produto novo ao catálogo, adicione a entrada
correspondente aqui, ou os pedidos desse produto não vão gerar eventos no
Trackio (regra 6).

### Mapeamento sugerido (os 8 produtos atuais)

| Produto local | Identificador local (`pedido.itens[].id` / `data/products.json`) | Código Trackio sugerido | Nome completo para o cliente |
|---|---|---|---|
| Kit 10 Potes Vidro Hermético | `16069manteiga` | `CM-001` | Kit 10 Potes Vidro Hermetico Marmita Fitness Com Tampa Quatro Travas Retangular Anti Vazamento |
| Pote Vidro Hermético 1040ml | `NOVO16069MARGARINA` | `CM-002` | Pote Vidro Hermético 1040ml Marmita Tampa Trava Vedação |
| Conjunto Talheres/Faqueiro 24 peças | `16079fuba` | `CM-003` | Conjunto Talheres e Faqueiro Aço Inoxidável 24 Peças Durável Elegante Sofisticado Refeições |
| Conjunto Marinex 5 Travessas | `CONJ-MARINEX-5PC` | `CM-004` | Conjunto Marinex Jogo de Travessas 5 (CINCO) peças Variadas em Vidro Temperado próprias P/ Forno |
| Pote Hermético Vidro 1L (Vinagrete) | `CV-336vinagrete` | `CM-005` | Pote Hermético Vidro (1 Litro) - Vinagrete |
| Kit 3 Garrafas My Box 1L | `KIT-GARRAFA-MYBOX` | `CM-006` | Kit 3 Garrafas para Bebidas Decorativa My Box 1 Litro |
| Conjunto Panelas 8 Peças Brinox | `BRINOX-CERAMIC-SMARTPLUS-8PC` | `CM-007` | Conj de Panelas 8 Peças Ceramic Life Smart Plus Vanilla - Brinox |
| Processador Multislice Gaabor | `GAABOR-MULTISLICE-2L-PRETO` | `CM-008` | Processador Multislice Gaabor 2 Litros Vidro 4 Lâminas Cor Preto |

Os identificadores locais e os nomes completos vieram de `data/products.json`
(gerado automaticamente — é o que já existe hoje). Os códigos `CM-00X` são só
uma sugestão sequencial; troque pelos códigos reais do seu cadastro no
Trackio antes de ir para produção, mantendo a mesma chave (identificador
local) para cada produto.

## Rota a cadastrar no painel da Frendz

```
POST https://SEU-DOMINIO/api/frendz/webhook/SEU_FRENDZ_WEBHOOK_TOKEN
```

Essa rota é **separada** do postback interno já existente
(`/api/webhooks/frendz`, usado para confirmar o pedido local e acionar
Dracofy/Rastreio Express — ver `FRENDZ.md`). A rota nova só repassa a
confirmação de pagamento ao Trackio:

- Valida `:token` contra `FRENDZ_WEBHOOK_TOKEN` (comparação em tempo
  constante); token incorreto ou ausente → `401`.
- Ignora (retorna `200`, sem chamar o Trackio) quando: faltam
  `transaction.id`/`status`, o status não é `paid`, ou o produto
  (`offer.hash` / `items[].product_hash`) não corresponde a
  `FRENDZ_OFFER_HASH` / `FRENDZ_PRODUCT_HASH`.
- Deduplica por `transaction.id + status`: uma transação com o mesmo par
  já processado não reenvia ao Trackio (fica salvo em
  `pedido.trackioWebhook.ultimoEvento`).
- Usa `transaction.pix.code` como código Pix e só usa `transaction.pix.url`
  se for uma URL pública HTTPS válida.
- Erros inesperados retornam `503` (para a Frendz tentar reentrega); nunca
  retorna `5xx` para token inválido ou evento ignorado.

O `checkout-started` **não** vem desse webhook — ele é enviado direto pelo
backend no momento em que `POST /api/pedidos` cria o Pix (ver
`routes/api.js`, função `trackio.notificarCheckoutIniciado`).

## Como testar localmente

```bash
# instala dependências, se ainda não tiver feito
npm install

# roda todos os testes automatizados (inclui os cenários do Trackio)
node --test tests/*.test.js
```

Os testes relevantes estão em `tests/trackio-frendz.test.js` e cobrem:

1. Token inválido no webhook → `401`.
2. Pagamento aprovado → `POST {TRACKIO_ORIGIN}/api/webhooks/zuckpay/{slug}`
   com `event: "payment_approved"`, payload (incluindo `product_code`/
   `product_name` do produto real do pedido) e assinatura
   `X-ZuckPay-Signature` corretos; pedido marcado para não duplicar.
3. Evento duplicado (mesmo `transaction.id` + `status`) → não reenvia.
4. Produto fora da whitelist Frendz (`offer.hash`/`items[].product_hash`
   não configurados) → não envia ao Trackio.
5. Produto do pedido sem entrada em `TRACKIO_PRODUCTS_JSON` → nenhum evento
   (nem checkout-started, nem payment_approved) é enviado; só um aviso no
   log (regra 6).
6. Checkout iniciado → `POST {TRACKIO_ORIGIN}/api/webhooks/checkout-started/{slug}`
   com payload (produto real resolvido pelo carrinho local) e assinatura
   corretos, e nunca reenvia depois do primeiro envio.
7. Criação do pedido Frendz (`POST /api/pedidos`) → dispara
   `trackio.notificarCheckoutIniciado` imediatamente, sem bloquear a
   resposta do checkout.

Para testar manualmente o webhook contra o servidor local:

```bash
curl -X POST "http://localhost:3000/api/frendz/webhook/SEU_FRENDZ_WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "transaction": {
          "id": "hash-da-transacao-de-um-pedido-real-local",
          "status": "paid",
          "paid_at": "2026-01-01T12:00:00.000Z",
          "customer": { "name": "Teste", "email": "teste@example.invalid" },
          "pix": { "code": "codigo-copia-cola" }
        },
        "offer": { "hash": "SEU_FRENDZ_OFFER_HASH" }
      }'
```

Use o `id`/hash de um pedido Frendz já criado localmente (campo
`pagamento.providerChargeId` em `data/orders.json`), senão o webhook
responde `200` e ignora por não achar o pedido local.

Para ver o evento `checkout-started` sendo enviado, configure as variáveis
`TRACKIO_*` no `.env`, crie um pedido pela loja (`PIX_PROVIDER=frendz`) e
acompanhe os logs do servidor — falhas de rede com o Trackio aparecem como
aviso (`console.warn`) e nunca quebram o checkout.
