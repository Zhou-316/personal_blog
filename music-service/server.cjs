const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const runtime = path.join(__dirname, ".runtime");
fs.mkdirSync(runtime, { recursive: true });
process.env.TEMP = runtime;
process.env.TMP = runtime;
process.env.TMPDIR = runtime;
global.deviceId = randomUUID().replaceAll("-", "");
// Some upstream versions log rejected response objects, including Set-Cookie.
const originalLog = console.log;
console.log = (...args) => args[0] === "[ERR]" ? originalLog("NetEase request failed") : originalLog(...args);
const api = require("@neteasecloudmusicapienhanced/api");
const { createQrCheck } = require("./qr-auth.cjs");
const checkQr = createQrCheck(require("@neteasecloudmusicapienhanced/api/util/request"));
require("axios").default.defaults.timeout = 12000;
const { getXeapiPublicKey } = require("@neteasecloudmusicapienhanced/api/util/xeapiKey");
let keyInitialization;
async function preparePlayback() {
  if (!keyInitialization) {
    keyInitialization = (async () => {
      const filename = path.join(runtime, "xeapi_public_key");
      let previous = {};
      try { previous = JSON.parse(fs.readFileSync(filename, "utf8")); } catch {}
      const key = await getXeapiPublicKey(previous, global.deviceId);
      fs.writeFileSync(filename, JSON.stringify(key));
    })().catch((error) => { keyInitialization = null; throw error; });
  }
  await keyInitialization;
}

// Only the blog's required operations are exposed, on loopback. Credentials
// always come from the individual listener; no shared account or unlock routes.
const operations = {
  "/song/detail": api.song_detail,
  "/song/url": api.song_url_v1,
  "/login/qr/key": api.login_qr_key,
  "/login/qr/create": api.login_qr_create,
  "/login/qr/check": checkQr,
  "/login/status": api.login_status,
};

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET" && req.url === "/health") {
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  const operation = operations[req.url];
  if (req.method !== "POST" || !operation) {
    res.writeHead(404).end(JSON.stringify({ code: 404 }));
    return;
  }
  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 16384) {
        res.writeHead(413).end(JSON.stringify({ code: 413 }));
        return;
      }
    }
    const input = JSON.parse(body || "{}");
    if (req.url === "/song/url") await preparePlayback();
    // Override options that could switch accounts, hosts, or audio sources.
    const result = await operation({
      id: input.id,
      ids: input.ids,
      key: input.key,
      qrimg: true,
      platform: "web",
      noCookie: true,
      cookie: typeof input.cookie === "string" ? input.cookie : "",
      level: "standard",
      unblock: "false",
      timeout: 12000,
    });
    if (req.url === "/login/qr/check" && result.body?.code === 803) {
      // Only response structure is logged, never QR keys or credential values.
      console.log("QR authorization response", JSON.stringify({
        fields: Object.keys(result.body),
        cookieType: typeof result.body.cookie,
        cookieLength: typeof result.body.cookie === "string" ? result.body.cookie.length : 0,
        credentialHeaderCount: result.body.cookies?.length || 0,
        containsMusicU: (result.body.cookies || []).some(header => /(?:^|[;,]\s*)MUSIC_U=/.test(header))
          || /(?:^|[;,]\s*)MUSIC_U=/.test(typeof result.body.cookie === "string" ? result.body.cookie : ""),
      }));
    }
    res.end(JSON.stringify(result.body));
  } catch {
    // Upstream errors can contain account cookies; never log or echo them.
    res.writeHead(502).end(JSON.stringify({ code: 502, message: "网易云服务暂时无法连接，请稍后重试" }));
  }
});

server.requestTimeout = 20000;
server.listen(Number(process.env.BLOG_MUSIC_PORT || 3001), "127.0.0.1", () => {
  console.log(`Blog music service: http://127.0.0.1:${server.address().port}`);
});
