# Build a plugin with an agent

[`skills/lawallet-plugin`](../skills/lawallet-plugin) is an [Agent Skill](https://docs.claude.com/en/docs/claude-code/skills).
It teaches a coding agent the whole plugin loop:

1. Clone android-wallet.
2. Put a debug build on the Android emulator.
3. Scaffold a plugin from the template and test it offline.
4. Install or reload it in the running app, and check the result with a screenshot.

The skill is a `SKILL.md` and one script, [`scripts/lwdev`](../skills/lawallet-plugin/scripts/lwdev). The script
works the same without an agent.

## What you need

- **Android Studio**, with the Android SDK, the emulator, and one virtual device (Device Manager → API 34 or newer).
  It also ships the JDK the build uses.
- **Node.js 20+**, **Python 3** and **git**.
- **[Claude Code](https://docs.claude.com/en/docs/claude-code)**, or another agent that can read a skill (see
  [Other agents](#other-agents)).

## 1. Install the skill

Claude Code loads personal skills from `~/.claude/skills/`:

```bash
git clone --depth 1 https://github.com/lawalletio/mobile-plugins /tmp/lwp
mkdir -p ~/.claude/skills && cp -R /tmp/lwp/skills/lawallet-plugin ~/.claude/skills/
```

To update it later, run the same two commands again (`rm -rf /tmp/lwp` first).

## 2. Start the agent

Start it in an empty folder, with Opus 5.5:

```bash
mkdir -p ~/lawallet-dev && cd ~/lawallet-dev
claude --model claude-opus-5-5
```

## 3. Ask for a plugin

```
/lawallet-plugin Set up LaWallet for Android on the emulator, then build a plugin for <Provider>.
Their API docs: <link>. Install it on the emulator when its tests pass.
```

What happens next:

| Step | The agent runs | You |
|---|---|---|
| Get the code | `lwdev setup`: clones android-wallet into `~/lawallet-dev/android-wallet`, and this repo into its `plugins-dev/` | |
| Run the app | `lwdev app`: boots the emulator, builds the debug app (a few minutes the first time), installs it as `io.lawallet.wallet.preview` | **Sign up or log in once** in the app on the emulator |
| Serve plugins | `lwdev serve` (kept running) | |
| Write it | `lwdev new <folder> <id> "<Name>"`, then edits `manifest.json` and `index.js` against [plugin-api.md](plugin-api.md) | Answer questions about the provider's API |
| Test it | `lwdev test <folder>`: offline, against a faked provider | |
| Install it | `lwdev install <id>`, then `lwdev shot`: Settings → Plugins → Local (development) → Install | **Sign in to the provider** on its own page, if the plugin has a web login |
| Iterate | edit, `lwdev test`, then `lwdev reload <id>` (keeps the login) | Try it in the app |
| Publish | commits in `plugins-dev/` and opens a PR here | Approve the push and the PR |

The agent never sees your provider password. You type it on the provider's own page inside the app, and the plugin
only keeps the token it extracts.

### Already have android-wallet checked out?

Point the skill at your checkout. Its branch is never switched:

```bash
export LAWALLET_ANDROID=~/code/android-wallet
```

The checkout needs the plugin host (`scripts/plugins-dev.py`). That means `main` once
[lawalletio/android-wallet#73](https://github.com/lawalletio/android-wallet/pull/73) merges; until then, its branch
`claude/plugin-wallet-modules-39013a`. A fresh `lwdev setup` picks the right one.

## Without an agent

The same steps by hand:

```bash
L=~/.claude/skills/lawallet-plugin/scripts/lwdev
$L setup && $L app          # then sign up or log in once in the emulator's app
$L serve                    # leave running; in another terminal:
$L new acme io.acme.wallet "Acme" && $L test acme && $L install io.acme.wallet
```

`lwdev` with no arguments lists every command. `lwdev status` shows what's set up and running.

## Settings

| Variable | Default | |
|---|---|---|
| `LAWALLET_DEV` | `~/lawallet-dev` | Where `lwdev setup` clones android-wallet |
| `LAWALLET_ANDROID` | `$LAWALLET_DEV/android-wallet` | An existing checkout to use instead |
| `LAWALLET_PLUGINS_REPO` | `https://github.com/lawalletio/mobile-plugins` | Your fork, if you'll open PRs from it |
| `ANDROID_SERIAL` | the first emulator | Which device to use |
| `LAWALLET_AVD` | the first virtual device | Which emulator `lwdev app` boots |
| `LAWALLET_ID_SUFFIX` | `.preview` | The side-by-side app id (`io.lawallet.wallet.preview`) |
| `LAWALLET_SERVE_PORT` | `8787` | This computer's port for `lwdev serve`, when 8787 is taken. The device keeps using 8787. |

## Safety

- **The app is a separate copy.** It installs as `io.lawallet.wallet.preview` next to any real LaWallet install,
  signed with your debug key, so it never touches a real wallet.
- **Nothing gets uninstalled.** The skill never uninstalls a LaWallet app (that would wipe the wallet), and never runs
  `connectedDebugAndroidTest` (that uninstalls the app).
- **Tests stay offline.** Plugin tests use fake data and never call the real provider.

## Other agents

`SKILL.md` is plain Markdown and `lwdev` is plain bash. For an agent without skill support, tell it:

```
Read ~/.claude/skills/lawallet-plugin/SKILL.md and follow it to build a LaWallet plugin for <Provider>.
```
