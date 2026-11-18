# Create a plugin

A plugin is a folder with two required files:

```
plugins/<name>/
  manifest.json   # who it is, which wallet methods it answers, what it may touch
  index.js        # one ES module, no imports
  icon.png        # optional, square, 512 KB max (256×256 is plenty)
  test.mjs        # its own checks: node plugins/<name>/test.mjs
  README.md       # what it does, what's verified against the real service, known limits
```

## 1. Start from the template

[`template/`](../template) is a complete, minimal wallet plugin for a made-up "Example" provider. It signs in on a web
page, then answers `get_balance`, `make_invoice` and `lookup_invoice`. Its test runs against a fake API with a stubbed
`host`.

```bash
cp -r template plugins/mywallet
node plugins/mywallet/test.mjs        # template: ok
```

Then replace the Example parts:

1. **`manifest.json`**
   - **`id`**: reverse-DNS, lowercase (`io.mywallet`). It **never changes**: the user's stored session, updates and a
     future native version all key on it.
   - **`name`**, **`description`** and **`version`**: any version change counts as an update.
   - **`wallet.methods`**: only the methods you actually answer. Leaving out `pay_invoice` hides every way to spend
     from your wallet in the app (Pay from, Withdraw).
   - **`permissions`**: the exact API hostnames, `secrets` if you keep tokens, and `webLogin.url` if users sign in on
     the provider's site. The user sees every one of these on the install sheet, so ask for nothing extra.
   - Every field and its rules: [manifest.json reference](plugin-api.md#manifestjson).
2. **`index.js`**
   - Point `API` and `LOGIN` at the real service.
   - Map its responses to NIP-47 results: amounts in **millisats**, times in **unix seconds**.
   - Throw `{ code, message }` with the [error codes](plugin-api.md#errors) the app understands. `UNAUTHORIZED` is the
     one that makes Send offer **Sign in to `<name>`**.

## 2. What the app calls

The default export is an object. Every function is optional and may be `async`. Each one gets `host` as its last
argument, and `host` is also `globalThis.host`.

| Export | When | Return |
|---|---|---|
| `request(method, params, host)` | Every NIP-47 method in `wallet.methods` | The method's result |
| `account(host)` | Often (Home, Settings). Read local state only, no network | `{ signedIn, label? }` |
| `login(host)` | The user taps **Sign in** or **Create `<name>` wallet** | ignored |
| `logout(host)` | **Sign out** | ignored |
| `poll(host)` | Every `background.pollSec`. **Not scheduled yet**, but part of API 1 | `[{ notification_type, notification }]` |

Timeouts, and what happens when an export is missing: [The plugin module](plugin-api.md#the-plugin-module).

## 3. What you can use

There's no `fetch`, `setTimeout`, `console` or `import`. You only get `host`:

| Call | For |
|---|---|
| `host.fetch(url, init)` | HTTPS to the manifest's hosts only. Every status resolves; redirects aren't followed. |
| `host.store.get/set` | Plain-text key/value storage: cursors, caches, non-secret settings. |
| `host.secrets.get/set` | Encrypted with an Android Keystore key: tokens and device ids. |
| `host.webLogin(url, extractJs)` | A full-screen sign-in on the provider's own page. Your expression extracts the session. |
| `host.prompt({ title, input: 'code', actions: ['resend'] })` | Ask the user for a code (OTP/2FA) during a payment. |
| `host.now()`, `host.uuid()` | Time in ms, a random UUID. |

Full signatures: [Host API](plugin-api.md#host-api). The runtime is QuickJS with a 32 MB heap and a 2 MB bundle. To use
TypeScript or npm packages, bundle them into the single `index.js` (for example
`esbuild src/index.ts --bundle --format=esm --outfile=index.js`).

## 4. Rules that keep users safe

- **No payment without the user.** `pay_invoice` is only called after the user confirms on LaWallet's Send screen.
  Don't add a confirmation of your own. If the provider wants a code, ask with `host.prompt`.
- **Never handle passwords.** Sign-in happens on the provider's page in `host.webLogin`. Extract a token, not
  credentials.
- **Write `message` for people.** It's shown when a payment fails. The app never logs it, and your plugin can't log at all.

## 5. Test it

Copy the stub `host` from [`template/test.mjs`](../template/test.mjs). It loads `index.js` the way the app does (one
module, default export) and fakes the provider. Keep the test passing **without network or real credentials**, and
cover at least these:

- signed out → `UNAUTHORIZED`
- `login` → `account().signedIn`
- each declared method
- an undeclared one → `NOT_IMPLEMENTED`
- `logout`

[`plugins/fiwind/test.mjs`](../plugins/fiwind/test.mjs) is a bigger example: concurrent token refresh, OTP prompts, and
paying exactly once.

## 6. Try it on a phone, then publish

- [Develop locally](develop-locally.md): run it on a debug build and Reload as you edit.
- Open a pull request adding `plugins/<name>/`. Once it's merged, the [directory](../README.md#directory) lists it with
  a QR code, and users [install it](install.md) from there.
