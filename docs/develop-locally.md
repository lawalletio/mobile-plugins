# Develop locally

Debug builds of LaWallet for Android read plugins from your computer, so you can edit `index.js` and see the change on
the phone in a second, without pushing anything.

## What you need

- A checkout of [lawalletio/android-wallet](https://github.com/lawalletio/android-wallet) and a **debug build** of it
  installed (`./gradlew installDebug`). See its `AGENTS.md` for setup.
  - Add `-PidSuffix=.preview` to install a side-by-side copy with fresh state, which leaves your real install alone.
- The emulator, or a phone connected over `adb`.

## 1. Serve your plugins

From the `android-wallet` checkout:

```bash
scripts/plugins-dev.py import https://github.com/lawalletio/mobile-plugins   # once: clones this repo into plugins-dev/
scripts/plugins-dev.py                                                       # serve it while you work
```

`plugins-dev/` is gitignored and is a normal clone of this repo, so work on a branch there. To use a fork, pass its
URL to `import` instead.

The server:

- **Port:** listens on **8787**, with caching off, so every Reload gets the file as it is now.
- **Plugin list:** answers `/index.json` with every `plugins/*/manifest.json` and `*/manifest.json` it finds. The
  [`template/`](../template) folder shows up too, so you can try it untouched.
- **Devices:** runs `adb reverse tcp:8787 tcp:8787` on every connected device, so they reach it at
  `http://localhost:8787`, the debug build's default. For a phone without adb, build the app with
  `-PpluginsDevUrl=http://<your-computer's-ip>:8787`. `--port 9000` changes the port.

## 2. Install from Local (development)

In the debug build: **Settings → Plugins → Local (development)**.

| Button | What it does |
|---|---|
| **Install** | Adds the plugin **without** the permissions sheet, since it's your own code. Then starts sign-in if the plugin has a web login. |
| **Reload** | Replaces the installed copy with `index.js` as it is now. Stored data and the login are kept, and the wallet reconnects to the new code. |
| **Refresh** | Re-reads the list and the manifests from the server. Do this after you add a plugin folder or change a `manifest.json`. |

If the section says to run `scripts/plugins-dev.py`, the phone can't reach the server. Check that the script is
running and that `adb devices` lists the phone.

## 3. The loop

1. Edit `plugins-dev/plugins/<name>/index.js`.
2. Tap **Reload** and try it in the app: the wallet card on Home, Transfer amount, Pay from in Send.
3. Run the plugin's own test: `node plugins/<name>/test.mjs`.
4. Commit and push from `plugins-dev/`, and open a pull request against this repo.

## Debugging tips

- The sandbox has no `console`. Return what you need in an error `message` while developing. The app shows it in
  Settings → Plugins (for example "Couldn't read the balance: …"), and never logs it.
- `http://` hosts are accepted by `host.fetch` in debug builds, so you can point `API` at a mock server on your
  computer. The hostname must still be in `permissions.hosts`.
- Changed `permissions` or `wallet.methods`? Tap **Refresh**, then **Reload**. Reload always downloads a fresh `index.js`,
  but it uses the manifest from the last Refresh.
- To test the real install path (GitHub resolver, commit pin, permissions sheet), push a branch and
  [install it by URL](install.md#by-github-url), for example
  `https://github.com/<you>/mobile-plugins/tree/<branch>/plugins/<name>`.
