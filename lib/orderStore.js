const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "orders.json");

function readAll() {
  if (!fs.existsSync(DB_PATH)) return [];
  const raw = fs.readFileSync(DB_PATH, "utf8").trim();
  if (!raw) return [];
  return JSON.parse(raw);
}

function writeAll(orders) {
  fs.writeFileSync(DB_PATH, JSON.stringify(orders, null, 2), "utf8");
}

function create(order) {
  const orders = readAll();
  orders.push(order);
  writeAll(orders);
  return order;
}

function findById(id) {
  return readAll().find((o) => o.id === id) || null;
}

function assertWritable() {
  fs.accessSync(fs.existsSync(DB_PATH) ? DB_PATH : path.dirname(DB_PATH), fs.constants.W_OK);
}

function update(id, changes) {
  const orders = readAll();
  const idx = orders.findIndex((o) => o.id === id);
  if (idx === -1) return null;
  orders[idx] = { ...orders[idx], ...changes };
  writeAll(orders);
  return orders[idx];
}

const local = { create, findById, update, readAll, assertWritable };
const locks = new Map();
local.withOrderLock = async (id, callback) => {
  const previous = locks.get(id) || Promise.resolve();
  const current = previous.catch(() => {}).then(callback);
  locks.set(id, current);
  try { return await current; }
  finally { if (locks.get(id) === current) locks.delete(id); }
};

function backend() {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) return require("./postgresOrderStore");
  if (process.env.VERCEL) {
    const error = new Error("Configure DATABASE_URL ou POSTGRES_URL na Vercel para persistir pedidos.");
    error.code = "ORDER_STORAGE_NOT_CONFIGURED";
    throw error;
  }
  return local;
}

module.exports = Object.fromEntries(Object.keys(local).map((method) => [method, (...args) => backend()[method](...args)]));
