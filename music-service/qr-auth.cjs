// Keep the original response cookie and each Set-Cookie header separate. The
// upstream module flattens headers into body.cookie and overwrites body.cookie.
function createQrCheck(request, { now = Date.now, ttlMs = 180000, maxEntries = 32 } = {}) {
  const completed = new Map();
  return async (query) => {
    for (const [key, cached] of completed) {
      if (cached.expiresAt <= now()) completed.delete(key);
    }
    const cached = completed.get(query.key);
    if (cached) return cached.result;
    const result = await request("/api/login/qrcode/client/login", { key: query.key, type: 3 }, {
      crypto: "eapi", cookie: {}, timeout: 12000,
    });
    const headers = Array.isArray(result.cookie) ? result.cookie : typeof result.cookie === "string" ? [result.cookie] : [];
    const normalized = {
      ...result,
      body: {
        ...result.body,
        cookie: result.body?.cookie || headers.join(";"),
        cookies: headers,
      },
    };
    const sources = [normalized.body.cookie, ...headers].filter(value => typeof value === "string");
    if (normalized.body.code === 803 && sources.some(value => /(?:^|[;,]\s*)MUSIC_U=(?:"[^"]+"|[^;,\s"]+)/.test(value))) {
      // Confirmation credentials may be issued only once. Keep them briefly,
      // isolated by QR key, so network retries can finish the same login.
      while (completed.size >= maxEntries) completed.delete(completed.keys().next().value);
      completed.set(query.key, { result: normalized, expiresAt: now() + ttlMs });
    }
    return normalized;
  };
}

module.exports = { createQrCheck };
