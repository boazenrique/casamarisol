const orderStore = require("./orderStore");
const rastreioExpressClient = require("./rastreioExpressClient");

// Se uma tentativa ficar "enviando" por mais tempo que isso (ex.: o processo
// caiu no meio da chamada HTTP, antes de gravar "enviado"/"erro"), ela é
// considerada abandonada e liberada para uma nova tentativa — evita que uma
// falha trave o pedido para sempre.
const ENVIANDO_STALE_MS = 5 * 60 * 1000;

// Tipos de item que, se um dia existirem no carrinho (order bump, upsell,
// downsell, cross-sell), nunca devem gerar rastreio próprio — só o produto
// principal aprovado gera rastreio.
const TIPOS_EXCLUIDOS = new Set([
  "upsell",
  "order_bump",
  "bump",
  "downsell",
  "cross_sell",
  "crosssell",
]);

function selecionarProdutoPrincipal(itens) {
  const lista = Array.isArray(itens) ? itens : [];
  const elegiveis = lista.filter((item) => !TIPOS_EXCLUIDOS.has(item?.tipo));
  const candidatos = elegiveis.length ? elegiveis : lista;

  return candidatos.reduce(
    (maior, atual) => (!maior || Number(atual.subtotal) > Number(maior.subtotal) ? atual : maior),
    null
  );
}

function montarPayload(pedido, produtoPrincipal) {
  return {
    transacao: {
      id: pedido.id,
      referenciaGateway: pedido.pagamento?.providerChargeId || null,
      gateway: "ZuckPay",
      data: pedido.criadoEm,
      valor: pedido.total,
    },
    comprador: {
      nome: pedido.cliente?.nome || null,
      email: pedido.cliente?.email || null,
      cpf: pedido.cliente?.cpf || null,
      telefone: pedido.cliente?.telefone || null,
    },
    // Endereço de entrega informado pelo comprador no checkout — nunca o
    // endereço fixo da loja.
    endereco: {
      cep: pedido.endereco?.cep || null,
      rua: pedido.endereco?.rua || null,
      numero: pedido.endereco?.numero || null,
      complemento: pedido.endereco?.complemento || null,
      bairro: pedido.endereco?.bairro || null,
      cidade: pedido.endereco?.cidade || null,
      uf: pedido.endereco?.uf || null,
    },
    produto: {
      nome: produtoPrincipal.nome,
      quantidade: produtoPrincipal.quantidade,
    },
  };
}

function tentativaEnviandoExpirada(rastreioExpress) {
  if (rastreioExpress?.status !== "enviando") return false;
  const desde = Date.parse(rastreioExpress.tentativaEm || "");
  if (Number.isNaN(desde)) return true; // sem timestamp confiável: trata como expirada
  return Date.now() - desde > ENVIANDO_STALE_MS;
}

/**
 * Envia ao Rastreio Express o pedido cujo pagamento acabou de ser
 * confirmado como aprovado (status "pago") por um sinal real da ZuckPay
 * (webhook ou consulta de status) — nunca a partir do botão de simulação de
 * pagamento do ambiente de teste.
 *
 * Idempotente: usa pedido.rastreioExpress.status como trava para garantir
 * que a mesma transação nunca gere dois rastreios, mesmo que o
 * webhook/polling dispare mais de uma vez para o mesmo pedido.
 *
 * Reprocessável com segurança: uma falha (status "erro") ou uma tentativa
 * "enviando" abandonada há mais de ENVIANDO_STALE_MS (ex.: processo caiu no
 * meio da chamada HTTP) liberam uma nova tentativa — o pedido nunca fica
 * travado permanentemente por uma indisponibilidade temporária do Rastreio
 * Express. Um "enviado" com sucesso, porém, é definitivo e nunca é refeito.
 */
async function processarPedidoAprovado(pedidoRecebido) {
  // Preparacao apenas: nenhuma consulta, gravacao ou envio enquanto desativada.
  if (process.env.RASTREIO_EXPRESS_ENABLED !== "true") return;
  if (!pedidoRecebido?.id) return;

  // Relê o pedido do orderStore agora, de forma síncrona e imediatamente
  // antes de checar/reivindicar a transação. Isso fecha uma corrida possível
  // quando duas chamadas concorrentes (ex.: webhook duplicado chegando
  // enquanto a primeira ainda está no meio de um "await" anterior, como o
  // notificarDracofy) recebem cada uma uma cópia desatualizada do pedido —
  // sem essa releitura, ambas poderiam ver "ainda não processado" e disparar
  // dois envios. Se não houver cache local disponível (ex.: hospedagem
  // serverless), cai no objeto recebido por parâmetro (melhor esforço).
  let pedido = pedidoRecebido;
  try {
    const fresco = orderStore.findById(pedidoRecebido.id);
    if (fresco) pedido = fresco;
  } catch (_) {}

  if (pedido.status !== "pago") return;

  const rastreioExpress = pedido.rastreioExpress;
  const emAndamento = rastreioExpress?.status === "enviando" && !tentativaEnviandoExpirada(rastreioExpress);
  const concluido = rastreioExpress?.status === "enviado";
  if (emAndamento || concluido) return;

  if (!rastreioExpressClient.isConfigured()) {
    console.warn(
      `Aviso: RASTREIO_EXPRESS_API_KEY não configurada — pedido ${pedido.id} não foi enviado ao Rastreio Express.`
    );
    return;
  }

  const produtoPrincipal = selecionarProdutoPrincipal(pedido.itens);
  if (!produtoPrincipal) return;

  const tentativas = (rastreioExpress?.tentativas || 0) + 1;

  // Reivindica a transação de forma síncrona (sem await entre a releitura
  // acima e esta escrita) antes de qualquer chamada de rede, para que um
  // segundo webhook/poll concorrente para o mesmo pedido veja o status
  // "enviando" e não dispare um segundo rastreio.
  try {
    orderStore.update(pedido.id, {
      rastreioExpress: { status: "enviando", tentativaEm: new Date().toISOString(), tentativas },
    });
  } catch (_) {
    // Sem cache local disponível (ex.: hospedagem serverless) — segue sem
    // trava local; nesse ambiente o próprio orderStore.create/update já não
    // persiste nada entre chamadas.
  }

  try {
    const resultado = await rastreioExpressClient.enviarPedido(
      montarPayload(pedido, produtoPrincipal)
    );
    try {
      orderStore.update(pedido.id, {
        rastreioExpress: {
          status: "enviado",
          rastreioId: resultado?.id || resultado?.rastreioId || null,
          enviadoEm: new Date().toISOString(),
          tentativas,
        },
      });
    } catch (_) {}
  } catch (err) {
    console.warn(`Aviso: falha ao enviar pedido ${pedido.id} ao Rastreio Express (tentativa ${tentativas}):`, err.message);
    try {
      orderStore.update(pedido.id, {
        rastreioExpress: {
          status: "erro",
          erro: err.message,
          tentativaEm: new Date().toISOString(),
          tentativas,
        },
      });
    } catch (_) {}
  }
}

module.exports = { processarPedidoAprovado, selecionarProdutoPrincipal };
