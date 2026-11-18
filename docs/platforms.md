# Android and iOS

The plugin contract is meant to be the same on every LaWallet app: the same `manifest.json`, the same `index.js` and the
same NIP-47 calls. Today only Android runs it.

| | Android | iOS |
|---|---|---|
| Status | **Available** in debug builds, and in release builds made with `-Pplugins` | **Not available yet.** Planned, not built |
| JS engine | QuickJS, one context per plugin on its own thread | JavaScriptCore (planned) |
| Host API | `fetch`, `store`, `secrets`, `webLogin`, `prompt`, `uuid`, `now` ([reference](plugin-api.md#host-api)) | Same contract (planned) |
| Secrets | Encrypted with an Android Keystore key | Not decided |
| Web login | Full-screen WebView locked to the declared site | — |
| Install | Add Plugin by GitHub URL, QR / `lawallet:plugin` link, Local (development) | — |
| Native plugins | A Kotlin `Wallet` registered under the same `id` | A Swift protocol (planned) |

## Android (live)

Everything in these docs describes Android. The host is in
[lawalletio/android-wallet](https://github.com/lawalletio/android-wallet) under `core/plugin/`.

- **Sandbox:** a QuickJS context with a 32 MB heap and a 512 KB stack. There's no file system, no `std`/`os` and no
  imports.
- **Network:** HTTPS to the manifest's hosts only, with no cookies and no LaWallet credentials. Debug builds also allow
  `http://`, so you can test against a local server.
- **Storage:** keyed by plugin `id`. An update from the same source keeps it, and removing the plugin wipes it.
- **Limits:** every call has a timeout, and a plugin stuck in a busy loop is stopped without affecting the app. See
  [Runtime limits](plugin-api.md#runtime-limits).

## iOS (planned, not available)

> There is no iOS plugin host yet. Nothing below can be installed or tested today.

The plan is for the iOS app to run the **same `index.js`** on **JavaScriptCore**, behind a Swift protocol that mirrors
Android's `Wallet` interface: one `request(method, params)` in NIP-47 terms, plus notifications. If that holds, a plugin
written against [API 1](plugin-api.md) works on both platforms unchanged.

What we don't know yet: the exact iOS limits (heap, timeouts), how the web login is presented, and how plugins are
installed. They'll be documented here when the iOS host exists, and anything that differs from Android will be listed
in the table above.

To stay portable in the meantime:

- Use only what's in the [host API](plugin-api.md#host-api) and standard ECMAScript. Don't rely on QuickJS-specific
  globals.
- Keep the bundle a single ES module with no imports.
- Don't assume an exact timeout or heap size beyond the documented limits.
