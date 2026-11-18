# Install a plugin in the app

> **Android only, debug builds for now.** Settings → Plugins is in debug builds, and in release builds made with
> `-Pplugins`. Regular release builds (Play Store, Zapstore, GitHub releases) don't have it yet. Scanning a plugin QR
> code there shows "Plugins aren't available in this build".

There are two ways to start an install: a GitHub URL or a QR code. Both end in the same **permissions sheet**, and
nothing is installed until you confirm it.

## By GitHub URL

**Settings → Plugins → Add Plugin**, then paste one of these:

| URL | What the app offers |
|---|---|
| `https://github.com/lawalletio/mobile-plugins` | every plugin in `plugins/` on the default branch |
| `https://github.com/<owner>/<repo>/tree/<ref>` | the same, on a branch, tag or commit (refs with `/` work) |
| `https://github.com/<owner>/<repo>/tree/<ref>/plugins/<name>` | just that plugin |
| `https://<host>/<path>/manifest.json` | that one plugin, with `main` resolved next to it |

The app reads the source **pinned to the commit** the ref pointed at right then. It downloads the manifest and bundle
from `raw.githubusercontent.com/<owner>/<repo>/<sha>/…`, so what you approve is exactly what runs. Browsing a GitHub
source costs two GitHub API calls (the unauthenticated limit is 60 an hour per IP).

## By QR code

Every plugin in the [directory](../README.md#directory) has a QR code. In the app, open the **scanner** (or copy the
link and use **Paste** on the scan screen), and point it at the code. On a phone, tapping the link also works.

The QR code holds an install link:

```
lawallet:plugin?url=<urlencoded GitHub URL>
```

For example, Fiwind's:

```
lawallet:plugin?url=https%3A%2F%2Fgithub.com%2Flawalletio%2Fmobile-plugins%2Ftree%2Fmain%2Fplugins%2Ffiwind
```

How the app handles it:

- **What the URL can be:** `url` is a GitHub URL in any of the forms above, usually one plugin's folder. A bare folder
  URL (`https://github.com/…/tree/…`) is accepted as well.
- **HTTPS GitHub only:** the scanner is stricter than Add Plugin. An `http://` URL or any other host (a `manifest.json`
  URL included) is rejected, so a QR code from a stranger can't point the app anywhere else.
- **No direct install:** the scanner opens **Add Plugin** for that URL. You still see the plugin, its version and the
  permissions sheet.
- **Use a branch, not a commit:** link to `tree/main/…`, not `tree/<sha>/…`. **Check for updates** re-reads the source
  the plugin was installed from, so a link pinned to a commit never sees an update. Each install is pinned to a commit
  anyway.

The app side of this is `PluginLink` / `ScanRouter` in android-wallet ([#75](https://github.com/lawalletio/android-wallet/pull/75)).

## The permissions sheet

Before anything is downloaded and run, the app lists what the manifest asks for:

| Manifest | The sheet says |
|---|---|
| `permissions.hosts` | Connects to `api.example.com` |
| `permissions.webLogin.url` | Asks you to sign in at `login.example.com` |
| `permissions.secrets` | Keeps your login on this device, encrypted |
| `background.pollSec` | Checks for payments every *n* seconds |

It also warns that a wallet plugin can move the money in that account. **Install** downloads the bundle (2 MB max),
records its SHA-256, and stores it. The app refuses to run the file if it ever stops matching. If the plugin has a web
login, sign-in opens right after.

## After installing

- **Home:** the plugin's wallet appears as a card in the Lightning wallet list once you're signed in.
- **Moving sats:** **Transfer amount** and **Withdraw to active wallet** are on the card's long-press menu.
  **Pay from** is in Send, but only for plugins that declare `pay_invoice`.
- **Settings → Plugins:** sign in or out, **Check for updates**, enable or disable, and **Remove** (which deletes the
  bundle and everything the plugin stored).
- **Updates:** an update from the **same source** keeps your login. The same `id` from a different source starts
  clean, so a look-alike can't read another plugin's session.
