const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PGlite } = require("@electric-sql/pglite");

test("Postgres persiste pedidos entre instancias e atualiza JSON sem perder campos", async () => {
  const db = new PGlite();
  const pg = require("pg");
  const originalPool = pg.Pool;
  const modulePath = require.resolve("../lib/postgresOrderStore");
  let connections = 0;
  class TestPool {
    on() {}
    query(sql, values) { return db.query(sql, values); }
    async connect() {
      connections++;
      return { query: (sql, values) => db.query(sql, values), release() { connections--; } };
    }
  }
  pg.Pool = TestPool;
  delete require.cache[modulePath];
  try {
    const first = require(modulePath);
    await first.assertWritable();
    const order = { id: "CM-TESTE", status: "pendente", total: 5,
      cliente: { nome: "Teste" }, pagamento: { transaction_hash: "hash-remoto" } };
    await first.create(order);
    delete require.cache[modulePath];
    const second = require(modulePath);
    assert.deepEqual(await second.findById(order.id), order);
    await second.update(order.id, { status: "pago" });
    await second.update(order.id, { dracofy: { status: "enviado" } });
    const saved = await first.findById(order.id);
    assert.equal(saved.status, "pago");
    assert.equal(saved.cliente.nome, "Teste");
    assert.equal(saved.pagamento.transaction_hash, "hash-remoto");
    assert.equal(saved.dracofy.status, "enviado");
    assert.equal(await first.findById("' OR 1=1 --"), null);
    await assert.rejects(first.create(order));
    await second.withOrderLock(order.id, async () => {
      await second.update(order.id, { confirmado: true });
    });
    await assert.rejects(second.withOrderLock(order.id, async () => {
      await second.update(order.id, { confirmado: false });
      throw Error("falha simulada");
    }), /falha simulada/);
    assert.equal((await first.findById(order.id)).confirmado, true);
    assert.equal(connections, 0);
    assert.equal((await first.readAll()).length, 1);
  } finally {
    pg.Pool = originalPool;
    delete require.cache[modulePath];
    await db.close();
  }
});
