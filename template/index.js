// Template wallet plugin for LaWallet. Copy this folder to plugins/<name>/ and replace the Example API calls.
// One ES module, no imports. The only way out of the sandbox is `host` (docs/plugin-api.md#host-api).

const API = "https://api.example.com"; // must be listed in manifest.permissions.hosts
const LOGIN = "https://login.example.com"; // must match manifest.permissions.webLogin.url

const fail = (code, message) => {
  throw { code, message };
};

/** GET/POST against the provider with the stored session. Every status resolves; only a dead network rejects. */
async function api(host, method, path, body) {
  const token = host.secrets.get("token");
  if (!token) fail("UNAUTHORIZED", "Sign in to Example first");
  const r = await host.fetch(API + path, {
    method,
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401) fail("UNAUTHORIZED", "Your Example session expired");
  if (r.status === 429) fail("RATE_LIMITED", "Example is busy, try again in a minute");
  if (r.status === 404) fail("NOT_FOUND", "Not found");
  if (r.status >= 400) fail("OTHER", `Example answered ${r.status}`);
  return JSON.parse(r.body);
}

/** Provider invoice → NIP-47 transaction. Amounts in msat, times in unix seconds. */
const tx = (i) => ({
  type: "incoming",
  state: i.paid ? "settled" : "pending",
  invoice: i.bolt11,
  description: i.memo || "",
  payment_hash: i.hash,
  amount: i.sats * 1000,
  created_at: i.created,
  expires_at: i.expires,
});

const methods = {
  async get_balance(host) {
    return { balance: (await api(host, "GET", "/balance")).sats * 1000 };
  },
  async make_invoice(host, { amount, description }) {
    return tx(await api(host, "POST", "/invoices", { sats: Math.floor(amount / 1000), memo: description }));
  },
  async lookup_invoice(host, { payment_hash }) {
    return tx(await api(host, "GET", "/invoices/" + payment_hash));
  },
};

export default {
  async request(method, params, host) {
    const fn = methods[method];
    if (!fn) fail("NOT_IMPLEMENTED", method);
    return fn(host, params || {});
  },

  // Local state only (no network): the app calls this often and caches the answer.
  async account(host) {
    const email = host.store.get("email");
    return host.secrets.get("token") ? { signedIn: true, label: email || undefined } : { signedIn: false };
  },

  // The user signs in on the provider's own page; the expression runs in that page until it returns a string.
  async login(host) {
    const session = JSON.parse(
      await host.webLogin(LOGIN, "localStorage.SESSION ? localStorage.SESSION : null"),
    );
    host.secrets.set("token", session.token);
    host.store.set("email", session.email || null);
  },

  async logout(host) {
    host.secrets.set("token", null);
    host.store.set("email", null);
  },
};
