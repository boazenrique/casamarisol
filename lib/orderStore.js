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

function update(id, changes) {
  const orders = readAll();
  const idx = orders.findIndex((o) => o.id === id);
  if (idx === -1) return null;
  orders[idx] = { ...orders[idx], ...changes };
  writeAll(orders);
  return orders[idx];
}

module.exports = { create, findById, update, readAll };
