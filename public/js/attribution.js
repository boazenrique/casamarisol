(function () {
  const key = "casamarisol_attribution";
  const fields = ["click_id", "fbc", "fbp", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"];
  let saved = {};
  try {
    const entry = JSON.parse(sessionStorage.getItem(key));
    if (entry && typeof entry === "object") saved = entry;
  } catch (_) {}
  const params = new URLSearchParams(location.search);
  // A new campaign must not inherit identifiers from the previous campaign.
  if (["click_id", "fbclid", "utm_source", "utm_campaign"].some((name) => params.has(name))) saved = {};
  for (const name of fields) {
    const value = params.get(name);
    if (value && value.trim()) saved[name] = value.trim().slice(0, 2048);
  }
  const fbclid = params.get("fbclid");
  if (fbclid) saved.fbc = `fb.1.${Date.now()}.${fbclid.slice(0, 1900)}`;
  function collect() {
    for (const name of ["fbc", "fbp"]) {
      const cookie = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`_${name}=`));
      if (!saved[name] && cookie) {
        try { saved[name] = decodeURIComponent(cookie.slice(name.length + 2)).slice(0, 2048); } catch (_) {}
      }
    }
    try {
      const id = window.DTrack?.getClickId?.();
      if (!saved.click_id && typeof id === "string" && id.trim()) saved.click_id = id.trim().slice(0, 2048);
    } catch (_) {}
    try { sessionStorage.setItem(key, JSON.stringify(saved)); } catch (_) {}
    return { ...saved };
  }
  window.CasaMarisolAttribution = { collect };
  collect();
})();
