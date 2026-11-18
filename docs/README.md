# LaWallet plugin docs

A LaWallet plugin adds a kind of wallet to the app: a `manifest.json` and one `index.js` that answers
[NIP-47](https://github.com/nostr-protocol/nips/blob/master/47.md) calls from inside a sandbox.

| Guide | What it covers |
|---|---|
| [Create a plugin](create-a-plugin.md) | Start from [`template/`](../template), what each export does, and testing without a network. |
| [Develop locally](develop-locally.md) | Serve your checkout to a debug build with `scripts/plugins-dev.py`, then **Install** and **Reload** from the phone. |
| [Install in the app](install.md) | By GitHub URL or QR code, through the permissions sheet. Also the `lawallet:plugin` link format. |
| [Plugin API reference](plugin-api.md) | Every manifest field, export, wallet method, error code, host call and runtime limit. |
| [Android and iOS](platforms.md) | What runs where: Android is live (QuickJS); iOS is planned (JavaScriptCore). |

## Source of truth

This repo holds the plugins and the docs for people writing them. The host (the sandbox, the permission rules, how the
app shows a plugin) lives in [lawalletio/android-wallet](https://github.com/lawalletio/android-wallet), and its
`docs/plugin-api.md` and `docs/plugins.md` are authoritative. [plugin-api.md](plugin-api.md) here is a synced copy. If
you find a difference, the app's copy wins. Please open an issue so both get fixed.

## Status

Plugins run on **Android only**, and only in **debug builds** for now: Settings → Plugins. A release build made with
`-Pplugins` also has them, for trying on a phone. Release builds get the section for good once manifests are signed.
