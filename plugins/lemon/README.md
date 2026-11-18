# Lemon plugin

This plugin shows your [Lemon](https://www.lemon.me) BTC balance in LaWallet as a Lightning wallet. LaWallet's plugin
host calls it with NIP-47 methods (`request`, `poll`, `account`, `login`, `logout`), and the plugin answers them with
Lemon's API.

> **Risk: this uses Lemon's private, unofficial API.** Lemon doesn't publish it. Every endpoint and shape was
> reverse-engineered from the Lemon Android app (`com.applemoncash` v3.0.21, a React Native / Hermes bundle) — see
> [API.md](API.md) for how. Lemon can change or break it at any time, its edge enforces device signatures and OTP that
> a sandboxed plugin can't fully reproduce, and using the API this way may conflict with Lemon's terms. Ask Lemon for
> official API access before shipping this outside debug builds.

> **Nothing here has been run against a live Lemon account.** The shapes come from the app's bytecode, not from traffic.
> Search `UNVERIFIED` in [`index.js`](index.js) for each assumption. Treat 0.1.0 as a scaffold to verify, not a finished
> wallet.

## How it works

- **Login:** the user signs in on Lemon's own web app inside `host.webLogin` (so LaWallet never sees the password or the
  OTP). A short script then reads the access token out of that page's `localStorage` and hands it over. **UNVERIFIED:**
  the exact `localStorage` key isn't known, so the extractor probes the likely names (`accessToken`, `token`,
  `sessionToken`, …) and takes the first JWT-looking value. If Lemon's web app keeps its session in a cookie instead of
  `localStorage`, this returns nothing and login fails — adjust `EXTRACT_JS` once the real key is known.
- **Session:** the token is kept in `host.secrets`. Every request sends `Authorization: Bearer`, `X-Lemon-App-Version`,
  `X-Header-DeviceId`, and a desktop-browser `User-Agent` + `Origin` (in case Lemon's edge rejects non-browser clients,
  like Fiwind's WAF does). There's no refresh-token flow here: a 401 means "log in again".
- **Throttle:** requests run one at a time, capped at 600/hour.
- **Amounts:** NIP-47 is millisats; Lemon is assumed to work in **BTC with 8 decimals**. The `MSAT_PER_BTC` constant in
  `index.js` is the single knob if that assumption is wrong (e.g. the API actually takes sats).

## Endpoints used

Base: `https://api.lemoncash.io/api`. Full inventory (168 REST paths + 428 GraphQL operations) in [API.md](API.md).

| NIP-47 | Lemon | Status |
|---|---|---|
| `get_balance` | `GET /v1/wallets/` → `[{ currency, balance, … }]`, picks the `BTC` wallet | Path verified in app; response shape **UNVERIFIED** |
| `make_invoice` | `POST /v1/lightning-invoice` `{ amount, description, ttl }` → `{ paymentRequest, expiresAt }` | Request shape from disasm; response fields **UNVERIFIED** |
| `lookup_invoice` / `poll()` | No per-invoice status endpoint was found; settlement is detected by scanning `GET /v1/activities-v2/` for a matching incoming Lightning credit | **UNVERIFIED** heuristic (amount + time) |
| `list_transactions` | `GET /v1/activities-v2/?limit&offset` → activity records mapped to transactions | **UNVERIFIED** (`details` blob shape varies by type) |
| `pay_invoice` | `POST /v1/wallet-to-external-crypto-wallet-transfers-v2` `{ amount, external_crypto_wallet_address: <bolt11>, network: "LIGHTNING", currency: "BTC" }` + `Idempotency-Key` + OTP header | **UNVERIFIED**, and **off** (not in `manifest.wallet.methods`) |

`pay_invoice` is implemented but left out of the manifest (like the Fiwind plugin's 0.1.1), so LaWallet doesn't offer
"Pay from" or "Withdraw to active wallet" yet. It moves real money through an endpoint that needs an OTP header
(`otpHeader`) and an idempotency key whose exact names weren't verified. Add `"pay_invoice"` to `wallet.methods` only
after checking it against a real account.

## Still to verify against a real account

Each item is tagged `UNVERIFIED` in `index.js`.

1. **Web login token.** Which `localStorage` key (if any) holds a bearer usable against `api.lemoncash.io`, and whether
   the web app's token is accepted without the native app's `X-Device-Signature`.
2. **Balance unit and shape.** Is `/v1/wallets/` `balance` BTC (assumed) or sats? Is the array under `data` directly or
   under `data.wallets`?
3. **Invoice response.** The BOLT11 field (`paymentRequest` vs `invoice`) and the expiry field (`expiresAt` vs
   `expirationDate`). `amount` unit on the request.
4. **Settlement.** There's no invoice-status GET; `poll` guesses from `activities-v2`. The real signal is probably the
   `ResourceUpdates` websocket (`wss://api.lemoncash.io/ws/v3/`), which the plugin sandbox can't open.
5. **Activity mapping.** The `details` JSON differs per `activityType`; the incoming/outgoing split and amount/hash
   extraction are best-effort.
6. **`pay_invoice`.** OTP header name (bundle calls it `otpHeader`; the plugin sends `X-OTP`), the OTP-requirement query,
   the response `status` values, and the fee field.

## Known limits

- Only notices payments to invoices this plugin created, and only via the activity heuristic.
- `make_invoice` passes `description` through to Lemon but relies on the returned BOLT11's own description.
- No refresh-token rotation: when the token expires the user signs in again.

## Test

```bash
node plugins/lemon/test.mjs
```

The test stubs `globalThis.host` with a fake Lemon API, so it never calls the real one. It checks login through the
`localStorage` extractor, balance (BTC → msat), `make_invoice` → `lookup_invoice`, `poll` emitting `payment_received`
exactly once when a matching activity appears, `list_transactions` filtering, and `pay_invoice` going through the OTP
prompt and not paying twice.
