const test = require("node:test");
const assert = require("node:assert/strict");
const { createQrCheck } = require("./qr-auth.cjs");

test("preserves body credentials when the provider sends no Set-Cookie", async () => {
  const check = createQrCheck(async (path, data, options) => {
    assert.equal(path, "/api/login/qrcode/client/login");
    assert.equal(data.type, 3);
    assert.deepEqual(options.cookie, {});
    return { body: { code: 803, cookie: "MUSIC_U=listener-one;" }, cookie: [] };
  });
  const result = await check({ key: "one" });
  assert.equal(result.body.cookie, "MUSIC_U=listener-one;");
});

test("keeps separate Set-Cookie headers with trailing semicolons", async () => {
  const headers = ["__csrf=csrf; Path=/; HttpOnly;", "MUSIC_U=listener-one; Path=/; HttpOnly;"];
  const check = createQrCheck(async () => ({ body: { code: 803 }, cookie: headers }));
  const result = await check({ key: "one" });
  assert.deepEqual(result.body.cookies, headers);
});

test("retains one-time authorization for retries and isolates QR keys", async () => {
  let calls = 0;
  const check = createQrCheck(async (path, data) => {
    calls++;
    return { body: { code: 803 }, cookie: [`MUSIC_U=listener-${data.key}; Path=/;`] };
  });
  const first = await check({ key: "one" });
  const retried = await check({ key: "one" });
  assert.equal(calls, 1);
  assert.equal(retried.body.cookie, first.body.cookie);
  assert.notEqual((await check({ key: "two" })).body.cookie, first.body.cookie);
  assert.equal(calls, 2);
});

test("does not cache pending or incomplete authorization", async () => {
  let calls = 0;
  const check = createQrCheck(async () => ({ body: { code: ++calls === 1 ? 801 : 803 }, cookie: [] }));
  await check({ key: "one" }); await check({ key: "one" }); await check({ key: "one" });
  assert.equal(calls, 3);
});

test("expires successful credentials and bounds the in-memory cache", async () => {
  let currentTime = 1000;
  let calls = 0;
  const check = createQrCheck(async () => {
    calls++;
    return { body: { code: 803 }, cookie: ["MUSIC_U=listener; Path=/;"] };
  }, { now: () => currentTime, ttlMs: 100, maxEntries: 1 });
  await check({ key: "one" });
  currentTime += 101;
  await check({ key: "one" });
  assert.equal(calls, 2);
  await check({ key: "two" });
  await check({ key: "one" });
  assert.equal(calls, 4);
});
