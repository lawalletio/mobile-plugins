// Self-check for the template against a fake Example API. Run: node template/test.mjs
// No network, no real credentials: `host` is a stub with the same shape the app provides.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));

// ---- a stub host: in-memory store/secrets, fetch limited to the manifest's hosts, scripted web login ----
function stubHost(server) {
  const kv = () => {
    const m = new Map();
    return { get: (k) => m.get(k) ?? null, set: (k, v) => (v === null ? m.delete(k) : m.set(k, String(v))) };
  };
  return {
    store: kv(),
    secrets: kv(),
    now: () => 1_800_000_000_000,
    uuid: () => "00000000-0000-4000-8000-000000000000",
    async fetch(url, init = {}) {
      const u = new URL(url);
      if (u.protocol !== "https:" || !manifest.permissions.hosts.includes(u.hostname)) throw { code: "FORBIDDEN" };
      return server(init.method || "GET", u.pathname, init.headers || {}, init.body && JSON.parse(init.body));
    },
    async webLogin(url) {
      assert.equal(new URL(url).host, new URL(manifest.permissions.webLogin.url).host);
      return JSON.stringify({ token: "T1", email: "satoshi@example.com" });
    },
  };
}

// ---- a fake Example API ----
const invoices = new Map();
const json = (status, body) => ({ status, headers: {}, body: JSON.stringify(body) });
function example(method, path, headers, body) {
  if (headers.authorization !== "Bearer T1") return json(401, {});
  if (method === "GET" && path === "/balance") return json(200, { sats: 2100 });
  if (method === "POST" && path === "/invoices") {
    const inv = { bolt11: "lnbc1fake", hash: "ab".repeat(32), sats: body.sats, memo: body.memo, paid: false, created: 1, expires: 2 };
    invoices.set(inv.hash, inv);
    return json(200, inv);
  }
  const m = path.match(/^\/invoices\/(\w+)$/);
  if (method === "GET" && m) return invoices.has(m[1]) ? json(200, invoices.get(m[1])) : json(404, {});
  return json(404, {});
}

// ---- load index.js the way the app does: one module, default export ----
const src = readFileSync(new URL(`./${manifest.main}`, import.meta.url), "utf8");
assert.doesNotMatch(src, /^\s*import\s/m, "plugins can't import other files");
const plugin = (await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"))).default;
const host = stubHost(example);
globalThis.host = host;

// Signed out: account says so, wallet calls ask for a sign-in.
assert.deepEqual(await plugin.account(host), { signedIn: false });
await assert.rejects(plugin.request("get_balance", {}, host), { code: "UNAUTHORIZED" });

// Sign in through the web login.
await plugin.login(host);
assert.deepEqual(await plugin.account(host), { signedIn: true, label: "satoshi@example.com" });

// NIP-47: amounts in msat.
assert.deepEqual(await plugin.request("get_balance", {}, host), { balance: 2_100_000 });
const made = await plugin.request("make_invoice", { amount: 21_000, description: "coffee" }, host);
assert.equal(made.amount, 21_000);
assert.equal(made.state, "pending");
invoices.get(made.payment_hash).paid = true;
assert.equal((await plugin.request("lookup_invoice", { payment_hash: made.payment_hash }, host)).state, "settled");
await assert.rejects(plugin.request("lookup_invoice", { payment_hash: "00" }, host), { code: "NOT_FOUND" });

// Every method the manifest declares is answered; anything else is NOT_IMPLEMENTED.
for (const m of manifest.wallet.methods) assert.notEqual(await plugin.request(m, { payment_hash: made.payment_hash, amount: 1000 }, host), undefined);
await assert.rejects(plugin.request("pay_invoice", {}, host), { code: "NOT_IMPLEMENTED" });

// Sign out forgets the session.
await plugin.logout(host);
assert.deepEqual(await plugin.account(host), { signedIn: false });

console.log(`${manifest.name}: ok`);
