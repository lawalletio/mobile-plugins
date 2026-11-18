// Lemon wallet plugin for LaWallet: NIP-47 in, Lemon's private (unofficial) API out.
// Endpoints and request/response shapes were reverse-engineered from the Lemon Android app
// (com.applemoncash v3.0.21, a React Native / Hermes bundle). See API.md and README.md.
// Shapes marked UNVERIFIED were read from the app bytecode but never exercised on a live account.
//
// Plain ES2020, no imports. The only way out is `globalThis.host` (fetch, store, secrets, webLogin, prompt, now, uuid).

const API = "https://api.lemoncash.io/api"; // REST base; routes are "/v1/..."
const LOGIN = "https://www.lemon.me"; // Lemon web app; must match manifest.permissions.webLogin.url host
const APP_VERSION = "3.0.21"; // the captured app version; sent as X-Lemon-App-Version
const CURRENCY = "BTC";
const NETWORK = "LIGHTNING";
const MSAT_PER_BTC = 1e11;
// UNVERIFIED: Lemon amounts are assumed to be BTC with 8 decimals. If the API actually works in sats,
// flip this to 1e8 and toBtc/toMsat follow. ponytail: one knob, because the unit wasn't verified live.
const MAX_PER_HOUR = 600; // ponytail: per-device hourly cap, same idea as the fiwind plugin
const DEFAULT_TTL = 3600; // invoice expiry (seconds) when the caller doesn't give one

// Lemon's edge may reject non-app clients; send a browser-ish identity like the fiwind plugin does.
const BASE_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  origin: LOGIN,
  referer: LOGIN + "/",
  accept: "application/json",
  "content-type": "application/json",
  "x-lemon-app-version": APP_VERSION,
};

// Reads an access token out of the Lemon web app's localStorage after the user signs in there.
// UNVERIFIED: the exact localStorage key is unknown, so we probe the likely names and hand over the
// first JWT-looking value plus the device id if present. Returns null (="not yet") until something is found.
const EXTRACT_JS =
  "(function(){try{" +
  "var keys=['accessToken','access_token','token','sessionToken','authToken','LEMON_ACCESS_TOKEN','persist:auth'];" +
  "var tok=null;for(var i=0;i<keys.length;i++){var v=localStorage.getItem(keys[i]);if(!v)continue;" +
  "var m=v.match(/eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/);if(m){tok=m[0];break;}}" +
  "if(!tok)return null;var dev=localStorage.getItem('deviceId')||localStorage.getItem('X-Header-DeviceId')||null;" +
  "return JSON.stringify({accessToken:tok,deviceId:dev});}catch(e){return null;}})()";

const host = () => globalThis.host;
const nowSec = () => Math.floor(host().now() / 1000);
const fail = (code, message, extra) => {
  throw Object.assign({ code, message }, extra);
};
const toBtc = (msat) => Number((Math.floor(msat / 1000) / 1e8).toFixed(8)); // work in whole sats
const toMsat = (btc) => Math.round(Number(btc || 0) * MSAT_PER_BTC);

async function getJson(key, fallback) {
  const v = await host().store.get(key);
  return v ? JSON.parse(v) : fallback;
}
const setJson = (key, v) => host().store.set(key, JSON.stringify(v));

// ---- encoding (no atob/TextDecoder in the sandbox) — ported from the fiwind plugin ----

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function regroup(values, from) {
  const out = [];
  let acc = 0;
  let bits = 0;
  for (const v of values) {
    acc = ((acc << from) | v) & 0xffff;
    bits += from;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  return out;
}
const hex = (bytes) => bytes.map((b) => (b < 16 ? "0" : "") + b.toString(16)).join("");
function utf8(bytes) {
  try {
    return decodeURIComponent(bytes.map((b) => "%" + (b < 16 ? "0" : "") + b.toString(16)).join(""));
  } catch (e) {
    return String.fromCharCode(...bytes);
  }
}

/** The BOLT11 fields we need. Doesn't verify checksum/signature: Lemon does. */
function decodeBolt11(invoice) {
  const s = String(invoice || "").trim().toLowerCase().replace(/^lightning:/, "");
  const sep = s.lastIndexOf("1");
  const words = [...s.slice(sep + 1, -6)].map((c) => BECH32.indexOf(c));
  if (!s.startsWith("ln") || sep < 0 || words.length < 7 + 104 || words.includes(-1))
    fail("OTHER", "Invalid Lightning invoice");
  const m = s.slice(0, sep).match(/(\d+)([munp]?)$/);
  const out = {
    amount: m ? Math.round(Number(m[1]) * { "": 1e11, m: 1e8, u: 1e5, n: 100, p: 0.1 }[m[2]]) : 0,
    timestamp: words.slice(0, 7).reduce((a, w) => a * 32 + w, 0),
    expiry: 3600,
    payment_hash: "",
    description: "",
    description_hash: "",
  };
  for (let i = 7, end = words.length - 104; i + 3 <= end; ) {
    const tag = words[i];
    const len = words[i + 1] * 32 + words[i + 2];
    const data = words.slice(i + 3, i + 3 + len);
    i += 3 + len;
    if (tag === 1) out.payment_hash = hex(regroup(data, 5));
    else if (tag === 13) out.description = utf8(regroup(data, 5));
    else if (tag === 23) out.description_hash = hex(regroup(data, 5));
    else if (tag === 6) out.expiry = data.reduce((a, w) => a * 32 + w, 0);
  }
  if (out.payment_hash.length !== 64) fail("OTHER", "Invalid Lightning invoice");
  return out;
}

// ---- session ----

async function session() {
  const raw = await host().secrets.get("session");
  return raw ? JSON.parse(raw) : null;
}
const saveSession = (s) => host().secrets.set("session", JSON.stringify(s));

// ---- transport: serial queue + hourly cap ----

let queue = Promise.resolve();
function throttled(fn) {
  const run = queue.then(async () => {
    const h = host();
    const hour = Math.floor(h.now() / 3600000);
    const [at, n] = String((await h.store.get("lm:hour")) || "0:0").split(":").map(Number);
    const count = at === hour ? n + 1 : 1;
    if (count > MAX_PER_HOUR) fail("RATE_LIMITED", "Too many Lemon requests this hour, try again later");
    await h.store.set("lm:hour", `${hour}:${count}`);
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

/** The Lemon error body usually carries a user-facing message under `error`/`message`. */
const why = (b, status) => (b && (b.error?.message || b.message || b.error || b.viewMessage)) || `HTTP ${status}`;

/** Authenticated REST call. Every status resolves; only a dead network rejects (with NETWORK, by the host). */
async function call(path, init = {}) {
  const s = await session();
  if (!s || !s.accessToken) fail("UNAUTHORIZED", "Sign in to Lemon first");
  const headers = Object.assign({}, BASE_HEADERS, {
    authorization: "Bearer " + s.accessToken,
    "x-header-deviceid": s.deviceId || "",
  }, init.headers);
  const res = await throttled(() =>
    host().fetch(API + path, {
      method: init.method || (init.body === undefined ? "GET" : "POST"),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
  let body = {};
  try {
    body = JSON.parse(res.body || "{}");
  } catch (e) {}
  if (res.status === 401) fail("UNAUTHORIZED", "Your Lemon session expired. Log in again.");
  if (res.status === 429) fail("RATE_LIMITED", "Lemon is limiting requests, try again later");
  if (res.status === 404) fail("NOT_FOUND", why(body, res.status));
  if (res.status >= 400) fail(res.status >= 500 ? "INTERNAL" : "OTHER", why(body, res.status));
  // Lemon's REST helper wraps payloads as { data, error, status }; fall back to the raw body.
  return body && Object.prototype.hasOwnProperty.call(body, "data") ? body.data : body;
}

// ---- invoices we issued (store: "inv:<hash>" record, "pending" list of hashes to poll) ----

async function refreshInvoice(rec) {
  if (rec.state !== "pending") return rec;
  if (rec.expires_at && nowSec() > rec.expires_at) {
    rec.state = "expired";
    await setJson("inv:" + rec.payment_hash, rec);
    return rec;
  }
  // UNVERIFIED: Lemon exposes no per-invoice status GET that we found. Settlement is detected by scanning
  // recent activity for an incoming Lightning credit at/after the invoice with the same amount.
  // ponytail: amount+time heuristic; replace with a real status endpoint or the ResourceUpdates feed when known.
  try {
    const acts = await listActivities(20, 0);
    const hit = acts.find(
      (t) =>
        t.type === "incoming" &&
        t.state === "settled" &&
        t.created_at >= rec.created_at - 5 &&
        Math.abs(t.amount - rec.amount) <= 1000,
    );
    if (hit) {
      rec.state = "settled";
      rec.settled_at = hit.settled_at || nowSec();
      await setJson("inv:" + rec.payment_hash, rec);
    }
  } catch (e) {
    /* leave pending; try next tick */
  }
  return rec;
}

// ---- activities → NIP-47 transactions ----

// UNVERIFIED: `activities-v2` returns activity records whose `details` blob shape varies by activityType.
// We map defensively: incoming vs outgoing from the type/amount sign, amount from a numeric field in details.
function activityTx(a) {
  const d = a.details || a || {};
  const type = /SEND|WITHDRAW|PAYMENT|OUT|DEBIT/i.test(a.activityType || a.type || "") || Number(d.amount) < 0
    ? "outgoing"
    : "incoming";
  const amount = Math.abs(Number(d.amount ?? d.cryptoAmount ?? d.amountLightning ?? 0));
  const created = Math.floor(Date.parse(a.createdAt || d.createdAt || 0) / 1000) || nowSec();
  const settled = /CANCEL|REJECT|FAIL|EXPIR/i.test(d.status || a.status || "") ? null : created;
  return {
    type,
    state: settled ? "settled" : "failed",
    invoice: d.paymentRequest || d.invoice || "",
    description: d.description || d.comment || a.activityType || "",
    payment_hash: /^[0-9a-f]{64}$/i.test(d.paymentHash || "") ? d.paymentHash.toLowerCase() : "",
    preimage: "",
    amount: toMsat(amount),
    fees_paid: toMsat(d.fee || d.networkFee || 0),
    created_at: created,
    settled_at: settled,
  };
}

async function listActivities(limit, offset) {
  const q = `limit=${Math.min(Number(limit) || 50, 100)}&offset=${Number(offset) || 0}`;
  const data = await call(`/v1/activities-v2/?${q}`);
  const list = Array.isArray(data) ? data : data.content || data.activities || [];
  return list.map(activityTx);
}

// ---- NIP-47 methods ----

const methods = {
  // GET /v1/wallets/ → [{ currency, balance, displayedBalance, frozenBalance, ... }] (balance in BTC)
  async get_balance() {
    const data = await call("/v1/wallets/");
    const list = Array.isArray(data) ? data : data.wallets || [];
    const btc = list.find((w) => (w.currency || "").toUpperCase() === CURRENCY);
    if (!btc) return { balance: 0 };
    return { balance: toMsat(btc.balance) };
  },

  // POST /v1/lightning-invoice { amount (BTC), description, ttl } → { paymentRequest, expiresAt, ... }
  async make_invoice(p) {
    const btc = toBtc(p.amount);
    if (p.amount && !(btc > 0)) fail("OTHER", "The amount must be at least 1 sat");
    const data = await call("/v1/lightning-invoice", {
      method: "POST",
      body: { amount: btc, description: p.description || "", ttl: p.expiry || DEFAULT_TTL },
    });
    const bolt11 = data.paymentRequest || data.invoice;
    if (!bolt11) fail("INTERNAL", "Lemon didn't return a Lightning invoice");
    const dd = decodeBolt11(bolt11);
    const rec = {
      type: "incoming",
      invoice: bolt11,
      description: dd.description || p.description || "",
      description_hash: dd.description_hash,
      preimage: "",
      payment_hash: dd.payment_hash,
      amount: p.amount || dd.amount,
      fees_paid: 0,
      created_at: dd.timestamp || nowSec(),
      expires_at:
        (data.expiresAt && Math.floor(Date.parse(data.expiresAt) / 1000)) ||
        (dd.timestamp ? dd.timestamp + dd.expiry : nowSec() + DEFAULT_TTL),
      settled_at: null,
      state: "pending",
    };
    await setJson("inv:" + dd.payment_hash, rec);
    const pending = await getJson("pending", []);
    pending.push(dd.payment_hash);
    await setJson("pending", pending);
    return rec;
  },

  async lookup_invoice(p) {
    const hash = p.payment_hash || decodeBolt11(p.invoice).payment_hash;
    const rec = await getJson("inv:" + hash);
    if (!rec) fail("NOT_FOUND", "Invoice not found");
    return refreshInvoice(rec);
  },

  async list_transactions(p) {
    let txs = await listActivities(p.limit, p.offset);
    if (p.type === "incoming") txs = txs.filter((t) => t.type === "incoming");
    if (p.type === "outgoing") txs = txs.filter((t) => t.type === "outgoing");
    if (p.from) txs = txs.filter((t) => t.created_at >= p.from);
    if (p.until) txs = txs.filter((t) => t.created_at <= p.until);
    return { transactions: txs };
  },

  // UNVERIFIED end to end. Not listed in manifest.wallet.methods, so the app doesn't offer it yet (like fiwind 0.1.1).
  // POST /v1/wallet-to-external-crypto-wallet-transfers-v2 with the bolt11 as the LIGHTNING "address",
  // an Idempotency-Key, and an OTP header when Lemon requires one.
  async pay_invoice(p) {
    const d = decodeBolt11(p.invoice);
    const msat = d.amount || Number(p.amount) || 0;
    if (!msat) fail("OTHER", "This invoice has no amount");
    const prior = await getJson("pay:" + d.payment_hash);
    if (prior && prior.state === "settled") return { preimage: "", fees_paid: prior.fees_paid };
    if (prior && prior.state === "pending")
      fail("PAYMENT_FAILED", "This payment may already be in progress. Check your Lemon activity before retrying.");

    let otpHeaders;
    if (await otpRequired(toBtc(msat))) otpHeaders = await askOtpHeaders();

    const rec = { state: "pending", payment_hash: d.payment_hash, amount: msat, fees_paid: 0 };
    await setJson("pay:" + d.payment_hash, rec); // persisted before confirming: never auto-paid twice
    let data;
    try {
      data = await call("/v1/wallet-to-external-crypto-wallet-transfers-v2", {
        method: "POST",
        headers: Object.assign({ "idempotency-key": host().uuid() }, otpHeaders),
        body: {
          amount: toBtc(msat),
          external_crypto_wallet_address: p.invoice,
          network: NETWORK,
          currency: CURRENCY,
        },
      });
    } catch (e) {
      // Refused before Lemon acted on it (bad OTP, rate limit, expired session): nothing was sent.
      rec.state = "failed";
      await setJson("pay:" + d.payment_hash, rec);
      if (e && (e.code === "UNAUTHORIZED" || e.code === "RATE_LIMITED")) throw e;
      fail("PAYMENT_FAILED", (e && e.message) || "Lemon rejected the payment");
    }
    const state = String(data.status || data.state || "APPROVED").toUpperCase();
    if (!["APPROVED", "PENDING", "PROCESSING"].includes(state)) {
      rec.state = "failed";
      await setJson("pay:" + d.payment_hash, rec);
      fail("PAYMENT_FAILED", `Lemon rejected the payment (${state})`);
    }
    rec.state = state === "APPROVED" ? "settled" : "pending";
    rec.fees_paid = toMsat(data.networkFee || data.fee || 0);
    await setJson("pay:" + d.payment_hash, rec);
    return { preimage: "", fees_paid: rec.fees_paid }; // Lemon exposes no preimage
  },
};

// GET /v1/direct-transfers/otp-requirement?amount&currency → { otpRequired } (UNVERIFIED)
async function otpRequired(btc) {
  try {
    const r = await call(`/v1/direct-transfers/otp-requirement?amount=${btc}&currency=${CURRENCY}`);
    return !!(r && (r.otpRequired ?? r.required));
  } catch (e) {
    return true; // if we can't tell, ask for a code rather than skip it
  }
}

/** Asks the user for Lemon's OTP through the app and returns it as request headers. */
async function askOtpHeaders() {
  for (let error = null, i = 0; i < 5; i++) {
    const a = await host().prompt({
      title: "Lemon code",
      message: "Enter the code Lemon sent you to confirm this payment.",
      input: "code",
      error,
    });
    const code = String((a && a.value) || "").trim();
    if (code) return { "x-otp": code }; // UNVERIFIED header name (bundle calls it `otpHeader`)
    error = "Enter the code to continue";
  }
  fail("CANCELLED", "Payment cancelled: no code entered");
}

export default {
  async request(method, params) {
    const fn = methods[method];
    if (!fn) fail("NOT_IMPLEMENTED", `Lemon doesn't support ${method}`);
    return fn(params || {});
  },

  /** Checks the invoices we issued; emits payment_received once per invoice that settles. */
  async poll() {
    if (!(await session())) return [];
    const out = [];
    const pending = await getJson("pending", []);
    const keep = [];
    for (let i = 0; i < pending.length; i++) {
      const rec = await getJson("inv:" + pending[i]);
      if (!rec) continue;
      try {
        await refreshInvoice(rec);
      } catch (e) {
        keep.push(...pending.slice(i)); // offline / rate limited / logged out: retry the rest next tick
        break;
      }
      if (rec.state === "settled") out.push({ notification_type: "payment_received", notification: rec });
      else if (rec.state === "pending") keep.push(pending[i]);
    }
    await setJson("pending", keep);
    return out;
  },

  /** Local state only (no network): who's signed in, for the Plugins screen. */
  async account() {
    const s = await session();
    if (!s || !s.accessToken) return { signedIn: false };
    const email = await host().store.get("email");
    return { signedIn: true, label: email || undefined };
  },

  /** Login happens on Lemon's own web app; we take the session token it leaves in localStorage. */
  async login(h) {
    const host0 = h || host();
    const raw = await host0.webLogin(LOGIN, EXTRACT_JS);
    if (!raw) fail("UNAUTHORIZED", "Lemon login was cancelled");
    let s = {};
    try {
      s = JSON.parse(raw);
    } catch (e) {}
    if (!s.accessToken) fail("UNAUTHORIZED", "Couldn't read the Lemon session. Log in again.");
    await saveSession({ accessToken: s.accessToken, deviceId: s.deviceId || host0.uuid() });
    // Best-effort label; failure here shouldn't fail the login.
    try {
      const u = await call("/v1/user");
      const user = u.user || u;
      await host0.store.set("email", user.email || user.alias || null);
    } catch (e) {}
    return { connected: true };
  },

  async logout() {
    await host().secrets.set("session", null);
    await host().store.set("email", null);
    return { signedOut: true };
  },
};
