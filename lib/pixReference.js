const { createHmac, timingSafeEqual } = require("node:crypto");

function signature(payload) {
  const key = process.env.TIGGERPAY_API_KEY?.trim();
  if (!key) throw new Error("TIGGERPAY_API_KEY nao configurada.");
  return createHmac("sha256", key).update(`pix-reference:${payload}`).digest();
}

function createReference(orderId, transactionId) {
  const payload = Buffer.from(JSON.stringify({ orderId, transactionId })).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

function readReference(token, orderId) {
  if (typeof token !== "string" || token.length > 4096) return null;
  try {
    const [payload, mac, extra] = token.split(".");
    if (!payload || !mac || extra !== undefined) return null;
    const actual = Buffer.from(mac, "base64url");
    const expected = signature(payload);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.orderId === orderId && typeof data.transactionId === "string" && data.transactionId
      ? data.transactionId : null;
  } catch (_) { return null; }
}

module.exports = { createReference, readReference };
