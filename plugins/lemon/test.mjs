// Self-check for the Lemon plugin against a fake Lemon API. Run: node plugins/lemon/test.mjs
// No network, no real credentials: `host` is a stub with the same shape the app provides.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));

// ---- a structurally valid BOLT11 (fake signature/checksum), like the template/fiwind tests ----
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const toWords = (bytes) => {
  const out = [];
  let acc = 0, bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) out.push((acc >> (bits -= 5)) & 31);
  }
  if (bits) out.push((acc << (5 - bits)) & 31);
  return out;
};
const tag = (t, words) => [t, words.length >> 5, words.length & 31, ...words];
const TS = 1_800_000_000;
function bolt11(hashHex, sats, description = "test") {
  const words = [
    ...Array.from({ length: 7 }, (_, i) => Math.floor(TS / 32 ** (6 - i)) % 32),
    ...tag(1, toWords(Buffer.from(hashHex, "hex"))),
    ...tag(13, toWords(Buffer.from(description))),
    ...new Array(104).fill(0),
  ];
  return `lnbc${sats ? sats * 10 + "n" : ""}1` + words.map((w) => CHARSET[w]).join("") + "qqqqqq";
}

// ---- fake Lemon API ----
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0MiJ9.sig"; // matches EXTRACT_JS's eyJ... regex
const lemon = {
  access: JWT,
  invoices: new Map(),
  activities: [], // ownActivities content
  calls: [],
};
let clock = 1_800_000_000_000;
const json = (status, body) => ({ status, headers: {}, body: JSON.stringify(body) });

function server(method, path, headers, body) {
  lemon.calls.push(`${method} ${path.split("?")[0]}`);
  if (headers.authorization !== "Bearer " + lemon.access) return json(401, { error: "unauth" });
  assert.equal(headers["x-lemon-app-version"], "3.0.21");
  assert.equal(headers["x-header-deviceid"], "dev-1");

  if (method === "GET" && path === "/v1/user") return json(200, { data: { user: { email: "satoshi@lemon.me" } } });
  if (method === "GET" && path === "/v1/wallets/")
    return json(200, { data: [{ currency: "ARS", balance: 1000 }, { currency: "BTC", balance: 0.0005 }] });

  if (method === "POST" && path === "/v1/lightning-invoice") {
    assert.ok(typeof body.amount === "number" && "description" in body && "ttl" in body, "invoice body shape");
    const id = String(lemon.invoices.size + 1);
    const hash = id.padStart(64, "a");
    const pr = bolt11(hash, Math.round(body.amount * 1e8), body.description);
    lemon.invoices.set(hash, { amount: body.amount });
    return json(200, { data: { paymentRequest: pr, expiresAt: new Date(clock + 600_000).toISOString() } });
  }

  if (method === "GET" && path.startsWith("/v1/activities-v2/")) return json(200, { data: { content: lemon.activities } });

  if (method === "GET" && path.startsWith("/v1/direct-transfers/otp-requirement")) return json(200, { data: { otpRequired: true } });

  if (method === "POST" && path === "/v1/wallet-to-external-crypto-wallet-transfers-v2") {
    assert.ok(headers["idempotency-key"], "transfer needs an Idempotency-Key");
    if (headers["x-otp"] !== "123456") return json(400, { error: { message: "Código inválido" } });
    assert.equal(body.network, "LIGHTNING");
    assert.equal(body.currency, "BTC");
    assert.ok(body.external_crypto_wallet_address.startsWith("lnbc"), "sends the bolt11 as the address");
    return json(200, { data: { status: "APPROVED", networkFee: 0.00000002 } });
  }
  return json(404, { error: "no route " + path });
}

// ---- stub host (store/secrets in memory, fetch gated to manifest hosts, scripted login + prompt) ----
let answers = [];
const asked = [];
function kv() {
  const m = new Map();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => (v === null ? m.delete(k) : m.set(k, String(v))) };
}
const fakeLocalStorage = new Map(Object.entries({ accessToken: JWT, deviceId: "dev-1" }));
const host = {
  store: kv(),
  secrets: kv(),
  now: () => clock,
  uuid: () => "00000000-0000-4000-8000-000000000000",
  async fetch(url, init = {}) {
    const u = new URL(url);
    if (u.protocol !== "https:" || !manifest.permissions.hosts.includes(u.hostname)) throw { code: "FORBIDDEN" };
    const route = u.pathname.replace(/^\/api/, "") + u.search; // base is https://api.lemoncash.io/api
    return server(init.method || "GET", route, init.headers || {}, init.body && JSON.parse(init.body));
  },
  async webLogin(url, extractJs) {
    assert.equal(new URL(url).host, new URL(manifest.permissions.webLogin.url).host);
    const ls = { getItem: (k) => fakeLocalStorage.get(k) ?? null };
    return new Function("localStorage", `return ${extractJs}`)(ls); // exercises the real extractor
  },
  async prompt(o) {
    asked.push(o);
    const a = answers.shift();
    if (!a) throw { code: "CANCELLED", message: "Cancelled" };
    return a;
  },
};

// ---- load index.js the way the app does: one module, no imports, default export ----
const src = readFileSync(new URL(`./${manifest.main}`, import.meta.url), "utf8");
assert.doesNotMatch(src, /^\s*import\s/m, "plugins can't import other files");
const plugin = (await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"))).default;
globalThis.host = host;
const req = (m, p = {}) => plugin.request(m, p);

// Signed out: account says so, wallet calls ask for a sign-in.
assert.deepEqual(await plugin.account(), { signedIn: false });
await assert.rejects(req("get_balance"), { code: "UNAUTHORIZED" });

// Login via the web extractor, then account shows the email.
assert.deepEqual(await plugin.login(host), { connected: true });
assert.deepEqual(await plugin.account(), { signedIn: true, label: "satoshi@lemon.me" });

// Balance: 0.0005 BTC → 50_000 sats → 50_000_000 msat.
assert.deepEqual(await req("get_balance"), { balance: 50_000_000 });

// make_invoice → lookup_invoice (pending until an activity settles it).
const inv = await req("make_invoice", { amount: 21_000, description: "coffee" });
assert.equal(inv.type, "incoming");
assert.equal(inv.amount, 21_000);
assert.equal(inv.payment_hash, "1".padStart(64, "a"));
assert.equal(inv.state, "pending");
assert.equal((await req("lookup_invoice", { payment_hash: inv.payment_hash })).state, "pending");
assert.deepEqual(await plugin.poll(), [], "not paid yet");

// An incoming Lightning credit for the same amount appears → poll emits payment_received exactly once.
lemon.activities.unshift({
  activityType: "LIGHTNING_RECEIVE",
  createdAt: new Date(clock).toISOString(),
  details: { amount: 0.00000021, status: "COMPLETED", paymentRequest: inv.invoice },
});
let notes = await plugin.poll();
assert.equal(notes.length, 1);
assert.equal(notes[0].notification_type, "payment_received");
assert.equal(notes[0].notification.payment_hash, inv.payment_hash);
assert.deepEqual(await plugin.poll(), [], "fires only once");
assert.equal((await req("lookup_invoice", { payment_hash: inv.payment_hash })).state, "settled");

// list_transactions maps activities; the incoming credit is there.
const list = await req("list_transactions", { limit: 10 });
assert.ok(list.transactions.some((t) => t.type === "incoming" && t.amount === 21_000));
assert.deepEqual((await req("list_transactions", { type: "outgoing" })).transactions, []);

// pay_invoice (not in manifest, but implemented): OTP gate → prompt → transfer; doesn't pay twice.
const out = bolt11("c".repeat(64), 1000);
answers = [{ value: "123456" }];
assert.deepEqual(await req("pay_invoice", { invoice: out }), { preimage: "", fees_paid: 2_000 });
assert.equal(asked[0].input, "code");
const n = lemon.calls.length;
await req("pay_invoice", { invoice: out }); // already settled → no new transfer call
assert.equal(lemon.calls.slice(n).filter((c) => c.endsWith("transfers-v2")).length, 0);

// A wrong OTP fails cleanly without marking the invoice paid.
answers = [{ value: "000000" }];
await assert.rejects(req("pay_invoice", { invoice: bolt11("d".repeat(64), 1000) }), { code: "PAYMENT_FAILED" });

// Unknown method → NOT_IMPLEMENTED.
await assert.rejects(req("pay_keysend", {}), { code: "NOT_IMPLEMENTED" });

// Logout forgets the session.
assert.deepEqual(await plugin.logout(), { signedOut: true });
assert.deepEqual(await plugin.account(), { signedIn: false });
await assert.rejects(req("get_balance"), { code: "UNAUTHORIZED" });

console.log(`${manifest.name} plugin: all checks passed`);
