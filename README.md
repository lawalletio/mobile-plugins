# LaWallet mobile plugins

Plugins add new kinds of wallets to the LaWallet apps. Each one is a single JavaScript module that runs in a sandbox
(QuickJS on Android; JavaScriptCore on iOS is planned, not built yet) and speaks NIP-47, the same language as a Nostr Wallet Connect wallet.

| Plugin | What it does | Version |
|---|---|---|
| [Fiwind](plugins/fiwind) | Your Fiwind BTC balance as a Lightning wallet: balance, receive, movements | 0.1.1 |
| [Lemon](plugins/lemon) | Your Lemon BTC balance as a Lightning wallet: balance, receive, activity | 0.1.0 |

## Install one

In LaWallet for Android (debug builds for now), you can install a plugin in either of two ways:
- **Settings → Plugins → Add Plugin**: paste `https://github.com/lawalletio/mobile-plugins`, then pick a plugin.
- **Scan its QR code** from the [directory](#directory).

Either way, you review its permissions before anything installs. The app pins the plugin to the commit it read, and
checks the bundle's hash before running it. More in [docs/install.md](docs/install.md).

## Directory

`scripts/build-site.mjs` builds a static site from `plugins/*/manifest.json`. Each plugin gets a card with its methods,
permissions, source link and an install QR code. The script has no dependencies, and CI publishes the site to GitHub
Pages from `main`.

```bash
node scripts/build-site.mjs              # → dist/ (also fails on a manifest the app would reject)
python3 -m http.server 8790 -d dist      # preview at http://localhost:8790
```

Each QR code holds `lawallet:plugin?url=<urlencoded https://github.com/lawalletio/mobile-plugins/tree/main/plugins/<name>>`.
The app's scanner opens Add Plugin for that URL, and only accepts HTTPS GitHub links. `dist/plugins.json` lists the
same data for machines.

## Docs

| | |
|---|---|
| [Build with an agent](docs/build-with-an-agent.md) | The [`lawallet-plugin`](skills/lawallet-plugin) skill: from a prompt to a plugin on your emulator |
| [Create a plugin](docs/create-a-plugin.md) | Start from [`template/`](template), exports, testing |
| [Develop locally](docs/develop-locally.md) | `scripts/plugins-dev.py`, Local (development), Reload |
| [Install](docs/install.md) | GitHub URL, QR / `lawallet:plugin` links, the permissions sheet |
| [Plugin API reference](docs/plugin-api.md) | Manifest, NIP-47 methods, errors, host API, limits |
| [Android and iOS](docs/platforms.md) | Android is live (QuickJS); iOS is planned (JavaScriptCore) |

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
[docs/plugin-api.md](docs/plugin-api.md). That file is synced from the app repo, whose copy is authoritative.

## Build one with an agent

Install the [`lawallet-plugin`](skills/lawallet-plugin) skill, then ask Claude Code (Opus 5.5) for a plugin. The skill
clones android-wallet, builds it onto the Android emulator, scaffolds and tests the plugin, and installs it in the
running app. More in [docs/build-with-an-agent.md](docs/build-with-an-agent.md).

```bash
git clone --depth 1 https://github.com/lawalletio/mobile-plugins /tmp/lwp
mkdir -p ~/.claude/skills && cp -R /tmp/lwp/skills/lawallet-plugin ~/.claude/skills/
mkdir -p ~/lawallet-dev && cd ~/lawallet-dev && claude --model claude-opus-5-5
# then: /lawallet-plugin Set up LaWallet for Android on the emulator, then build a plugin for <Provider>…
```

## Develop locally

Full guide: [docs/develop-locally.md](docs/develop-locally.md). From an `android-wallet` checkout:

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

1. Copy [`template/`](template) to `plugins/<name>/` ([guide](docs/create-a-plugin.md)). The `id` is reverse-DNS
   (`io.example.wallet`) and never changes: an update from this repo keeps the user's session; the same id from
   anywhere else starts clean.
2. List only the hosts and methods it needs. The install sheet shows them to the user.
3. Keep `test.mjs` passing without network or real credentials (stub `globalThis.host`).
4. Say in its README what is verified against the real service and what isn't.
