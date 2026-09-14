# Preparacao do Rastreio Express

A credencial exclusiva desta oferta fica em `RASTREIO_EXPRESS_API_KEY`, no
arquivo `.env` local do backend, carregado pelo dotenv em `server.js`.
O arquivo e suas variantes estao ignorados pelo Git. O exemplo nao contem valor.
Em producao, configurar a mesma variavel no gerenciador de secrets da hospedagem;
a configuracao local nao atualiza automaticamente o servidor publicado.

`RASTREIO_EXPRESS_ENABLED=false` mantem a integracao inativa, inclusive para
chamadas diretas ao cliente. A preparacao nao envia pedidos nem credenciais.
O backend serve arquivos estaticos somente de `public/`.
Nunca copiar a credencial para essa pasta, templates, logs ou respostas de API.

Antes de ativar futuramente, confirmar com o Rastreio Express o dominio oficial,
endpoint, autenticacao e contrato de dados: o cliente preexistente usa suposicoes
ainda nao validadas. Revisar tambem respostas e erros do servico para evitar
reflexao de credenciais, bloquear redirecionamentos e definir timeout.
Nao ativar apenas por ter preenchido a chave.

Nenhuma configuracao de gateway ou rota de pagamento foi editada nesta preparacao.
Ja existiam alteracoes locais em `routes/api.js` ligando pagamentos ao Rastreio
Express; foram preservadas, com o envio agora desativado por padrao.
