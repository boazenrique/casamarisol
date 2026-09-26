const { AsyncLocalStorage } = require("node:async_hooks");
const { Pool } = require("pg");
const context = new AsyncLocalStorage();
let pool;
let initialized;

function database() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
      max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000, statement_timeout: 15000 });
    pool.on("error", () => console.error("Falha na conexao ociosa com o banco de pedidos."));
  }
  return pool;
}

function query(sql, values) { return (context.getStore() || database()).query(sql, values); }

async function ensureSchema() {
  if (!initialized) {
    initialized = database().query(`CREATE TABLE IF NOT EXISTS casa_marisol_orders (
      id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`).catch((error) => { initialized = undefined; throw error; });
  }
  await initialized;
}

async function assertWritable() {
  await ensureSchema();
  // Confere a conectividade antes de criar uma cobranca, inclusive em instancias quentes.
  await query("SELECT 1 FROM casa_marisol_orders LIMIT 1");
}

async function run(sql, values) {
  await ensureSchema();
  return query(sql, values);
}

async function create(order) {
  await run("INSERT INTO casa_marisol_orders (id, data) VALUES ($1, $2::jsonb)", [order.id, JSON.stringify(order)]);
  return order;
}

async function findById(id) {
  const result = await run("SELECT data FROM casa_marisol_orders WHERE id = $1", [id]);
  return result.rows[0]?.data || null;
}

async function update(id, changes) {
  const result = await run(`UPDATE casa_marisol_orders SET data = data || $2::jsonb,
    updated_at = now() WHERE id = $1 RETURNING data`, [id, JSON.stringify(changes)]);
  return result.rows[0]?.data || null;
}

async function readAll() {
  const result = await run("SELECT data FROM casa_marisol_orders ORDER BY updated_at");
  return result.rows.map((row) => row.data);
}

// Serializa os efeitos da confirmacao entre instancias da Vercel. As consultas
// dentro da callback usam a mesma conexao para nao esgotar o pool esperando locks.
async function withOrderLock(id, callback) {
  await ensureSchema();
  const client = await database().connect();
  let releaseError;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [id]);
    const result = await context.run(client, callback);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (rollbackError) { releaseError = rollbackError; }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

module.exports = { create, findById, update, readAll, assertWritable, withOrderLock };
