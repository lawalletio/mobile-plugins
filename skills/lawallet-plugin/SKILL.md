---
name: lawallet-plugin
description: Create, test and live-install LaWallet wallet plugins (a manifest.json plus one sandboxed index.js that answers NIP-47 calls) on a debug build of LaWallet for Android running in the emulator. Use when the user wants to build a LaWallet plugin, bring a Lightning wallet, exchange or bank into LaWallet as a plugin, set up the LaWallet plugin dev environment (clone android-wallet, build it onto the emulator), or install or reload a plugin on the device.
---

# LaWallet plugin development

A LaWallet plugin adds a kind of wallet to the app. It is a folder with a `manifest.json` (id, the NIP-47 methods it
answers, the exact hosts it may call, an optional web login) and one `index.js`: a single ES module with no imports that
runs in QuickJS. It can reach nothing but `host` (`fetch` to its declared hosts, `store`, `secrets`, `webLogin`,
`prompt`, `now`, `uuid`).

Everything here goes through **`scripts/lwdev`** in this skill's folder. Call it by its full path, or put the folder
on `PATH`. It works the same from a terminal.

## Before writing any plugin code

Read these from the plugins checkout (`$LAWALLET_DEV/android-wallet/plugins-dev/`, `~/lawallet-dev/...` by default).
They're authoritative; this skill only summarises them:

1. `docs/plugin-api.md`: every manifest field, export, wallet method, error code, host call and limit.
2. `docs/create-a-plugin.md`: the workflow and the safety rules.
3. `template/index.js` and `template/test.mjs`: the shape to copy. `plugins/fiwind/` is a full real example
   (token refresh, OTP prompts, paying exactly once).

## Workflow

Run `lwdev status` first. It shows what's already set up, so you skip done steps.

1. **Set up, once.** `lwdev setup` clones `lawalletio/android-wallet` into `~/lawallet-dev/android-wallet` and
   mobile-plugins into its `plugins-dev/`. If the user already has a checkout, set
   `LAWALLET_ANDROID=/path/to/android-wallet`; their branch is never switched. If they'll publish, set
   `LAWALLET_PLUGINS_REPO` to their fork.
2. **Put the app on the emulator.** `lwdev app` boots an emulator if none is running, builds the debug app and
   installs it as `io.lawallet.wallet.preview`, a side-by-side copy that never touches a real LaWallet install. The
   first build takes several minutes, so run it in the background. On first launch, ask the user to sign up or log in
   inside the app once. Plugins live under Settings, which needs an account.
3. **Serve plugins.** Run `lwdev serve` in the background and keep it running. It serves `plugins-dev/` on
   `localhost:8787`, which the app reaches through `adb reverse`. If a server is already up, it says what that server
   lists. If your plugin isn't there, the server is serving another checkout.
4. **Scaffold.** Run `lwdev new <folder> <reverse.dns.id> "<Title>"`, for example
   `lwdev new acme io.acme.wallet "Acme"`. The id never changes after release, because the user's stored session is
   keyed on it.
5. **Implement**, in `plugins-dev/plugins/<folder>/`:
   - **The provider's API.** Use its official docs, or ask the user for them. Never ask the user for a password in
     chat. Users sign in on the provider's own page through `host.webLogin(url, extractJs)`, and the plugin keeps
     only the token, in `host.secrets`.
   - **`manifest.json`.** List only what the plugin needs: exact `permissions.hosts`, `secrets`, the
     `webLogin.url`, and the `wallet.methods` you actually implement. Leave `pay_invoice` out until paying works.
   - **`index.js`.** Map responses to NIP-47 results: amounts in **millisats**, times in **unix seconds**. Throw
     `{ code, message }` with codes from the reference (`UNAUTHORIZED` makes Send offer "Sign in to …").
6. **Test offline.** Adapt `test.mjs` to fake the provider, with no network and no real credentials. Then run
   `lwdev test <folder>`. It must pass before you install.
7. **Install on the emulator.** Run `lwdev install <id>`. It opens Settings → Plugins → Local (development), refreshes,
   and taps Install. Then run `lwdev shot /tmp/lw.png` and look at the image. A plugin with a web login opens the
   provider's sign-in right after installing. The user signs in there, not you.
8. **Iterate.** Edit `index.js`, run `lwdev test <folder>`, then `lwdev reload <id>`. Reload keeps the plugin's
   login. Check the result on Home: the plugin's wallet card shows its balance, and a long-press opens Transfer /
   Withdraw.
9. **Ship.** In `plugins-dev/`, commit on a branch with Conventional Commits (`feat(<folder>): …`), push to the
   user's fork, and open a PR against `lawalletio/mobile-plugins`. Add a `README.md` that says what's verified
   against the real service and what isn't. Ask the user before pushing or opening the PR.

## Rules

- **Plugin contract.**
  - No `import`, `fetch`, `setTimeout` or `console`. Only `host`.
  - `account()` reads local state only.
  - `pay_invoice` runs only after the user confirms on LaWallet's Send screen, so never add your own confirmation.
    Ask for OTP/2FA codes with `host.prompt`.
  - Keep the bundle under 2 MB. To use TypeScript or npm, bundle everything into the one `index.js`.
- **Devices.**
  - Never `adb uninstall` a LaWallet package (it wipes the wallet), and never free space that way.
  - Never run `./gradlew connectedDebugAndroidTest`: it uninstalls the app.
  - Work on the `.preview` copy. Pick a device with `ANDROID_SERIAL` (default: the first emulator).
- **Privacy.** Keep tokens, invoices, amounts and account data out of logs, test fixtures and commits. Test data is
  fake.
- **`plugins-dev/` is gitignored in android-wallet.** Commit plugin work from inside `plugins-dev/` only.

## When something fails

| Symptom | Fix |
|---|---|
| `lwdev install` says Plugins didn't open | The app isn't logged in. Ask the user to sign up or log in once, then retry. |
| The id isn't in Local (development) | Check the manifest `id`. Make sure `lwdev serve` serves this `plugins-dev/` (`lwdev status`). Invalid manifests are skipped. |
| The app says to run `scripts/plugins-dev.py` | The server is down, or the device lost `adb reverse`. Run `lwdev serve`, then `lwdev install` again. |
| `INSUFFICIENT_STORAGE` | The emulator is full. Free space without uninstalling LaWallet, or wipe that emulator's data in Device Manager (ask first). |
| `UPDATE_INCOMPATIBLE` | Another signing key installed `.preview`. Use another copy: `LAWALLET_ID_SUFFIX=.plugins lwdev app` (and the same variable for later commands). |
| The plugin fails with `FORBIDDEN` | A host is missing from `permissions.hosts`, or the web login URL's host doesn't match `permissions.webLogin.url`. |
| An error shows in Settings → Plugins | The sandbox has no console. The message you threw is what you see. Throw descriptive messages while developing. |
