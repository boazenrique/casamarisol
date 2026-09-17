const FIELDS = ["click_id", "fbclid", "fbc", "fbp", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"];

function normalizeAttribution(value, legacyClickId) {
  const result = {};
  for (const field of FIELDS) {
    const item = value?.[field];
    if (typeof item === "string" && item.trim()) result[field] = item.trim().slice(0, 2048);
  }
  if (!result.click_id && typeof legacyClickId === "string" && legacyClickId.trim()) {
    result.click_id = legacyClickId.trim().slice(0, 2048);
  }
  return result;
}

module.exports = { normalizeAttribution };
