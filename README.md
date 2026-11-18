# LaWallet mobile plugins

Plugins add new kinds of wallets to the LaWallet apps. Each one is a single JavaScript module that runs in a sandbox
(QuickJS on Android, JavaScriptCore on iOS later) and speaks NIP-47, the same language as a Nostr Wallet Connect wallet.

| Plugin | What it does | Version |
|---|---|---|
| [Fiwind](plugins/fiwind) | Your Fiwind BTC balance as a Lightning wallet: balance, receive, movements | 0.1.1 |

## Install one

In LaWallet for Android: **Settings → Plugins → Add Plugin**, paste `https://github.com/lawalletio/mobile-plugins`,
and pick a plugin. The app pins what it installs to the commit it read, and checks the bundle's hash before running it.

## Layout

```
plugins/
  <name>/
    manifest.json   # id, name, version, wallet methods, the hosts it may call, web login…
    index.js        # one ES module, no imports (bundle TypeScript into it)
    icon.png        # optional
    test.mjs        # its own checks: node plugins/<name>/test.mjs
    README.md       # what it does, what's verified, known limits
```

Everything a plugin needs (its API client, session handling, login flow) lives in its folder. The app only provides
the host API, and nothing outside it:
- `fetch`: only to the hosts the manifest lists
- `store` and `secrets`: the plugin's own storage
- `webLogin`: a sign-in on its declared site
- `prompt`: ask the user for a code

The contract (manifest fields, NIP-47 methods, the host API and the isolation rules) is in
[android-wallet/docs/plugins.md](https://github.com/lawalletio/android-wallet/blob/main/docs/plugins.md).

## Develop locally

From an `android-wallet` checkout:

```bash
scripts/plugins-dev.py import https://github.com/lawalletio/mobile-plugins   # clones this repo into plugins-dev/
scripts/plugins-dev.py                                                       # serves it to debug builds
```

The second command forwards the dev port to every connected device with `adb reverse`. A debug build then lists the
plugins under **Settings → Plugins → Local (development)**:
- **Install** adds a plugin.
- **Reload** loads your latest `index.js` and keeps the plugin's login.

Commit and open pull requests from `plugins-dev/` against this repo.

## Adding a plugin

1. Create `plugins/<name>/` with the files above. The `id` is reverse-DNS (`io.example.wallet`) and never changes: an
   update from this repo keeps the user's session; the same id from anywhere else starts clean.
2. List only the hosts and methods it needs. The install sheet shows them to the user.
3. Keep `test.mjs` passing without network or real credentials (stub `globalThis.host`).
4. Say in its README what is verified against the real service and what isn't.
