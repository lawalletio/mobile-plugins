#!/usr/bin/env node
// Builds the plugin directory into dist/ from plugins/*/manifest.json. No dependencies: `node scripts/build-site.mjs`.
//
//   SITE_REPO   owner/repo the links point at   (default: $GITHUB_REPOSITORY or lawalletio/mobile-plugins)
//   SITE_REF    branch the install links use    (default: main; a branch, so Check for updates keeps working)
//   SITE_OUT    output directory                (default: dist)
//
// A manifest that breaks the app's rules (docs/plugin-api.md#manifestjson) fails the build, since the app would skip it.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, rmSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = process.env.SITE_REPO || process.env.GITHUB_REPOSITORY || "lawalletio/mobile-plugins";
const REF = process.env.SITE_REF || "main";
const OUT = join(ROOT, process.env.SITE_OUT || "dist");
const REPO_URL = `https://github.com/${REPO}`;
const SHA = process.env.GITHUB_SHA || (() => { try { return execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(); } catch { return "local"; } })();
const NIP47 = ["get_balance", "make_invoice", "pay_invoice", "lookup_invoice", "list_transactions"];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safePath = (p) => typeof p === "string" && p && !p.includes("://") && !p.startsWith("/") && !p.split("/").includes("..");
const hostOf = (u) => { try { return new URL(u).host; } catch { return ""; } };

/** The app's manifest rules (PluginManifest.parse): returns a list of problems, empty when valid. */
function problems(m, dir) {
  const out = [];
  if (!/^[a-z0-9]+(\.[a-z0-9-]+)+$/.test(m.id ?? "")) out.push("id must be reverse-DNS, lowercase");
  if (!String(m.name ?? "").trim()) out.push("name is required");
  if (!String(m.version ?? "").trim()) out.push("version is required");
  if ((m.api ?? 1) !== 1) out.push("api must be 1");
  const main = m.main ?? "index.js";
  if (!safePath(main)) out.push("main must be a relative path inside the folder");
  else if (!existsSync(join(dir, main))) out.push(`main (${main}) doesn't exist`);
  else if (statSync(join(dir, main)).size > 2 * 1024 * 1024) out.push("main is over 2 MB");
  if (m.icon != null && !safePath(m.icon)) out.push("icon must be a relative path inside the folder");
  const hosts = m.permissions?.hosts ?? [];
  if (!Array.isArray(hosts) || hosts.some((h) => typeof h !== "string" || !/^[a-z0-9.-]+$/i.test(h))) out.push("permissions.hosts must be bare hostnames");
  const wl = m.permissions?.webLogin?.url;
  if (wl != null && !String(wl).startsWith("https://")) out.push("permissions.webLogin.url must be https://");
  return out;
}

// ---------- read plugins ----------
const pluginsDir = join(ROOT, "plugins");
const plugins = [];
const errors = [];
for (const name of readdirSync(pluginsDir).sort()) {
  const dir = join(pluginsDir, name);
  if (!existsSync(join(dir, "manifest.json"))) continue;
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) { errors.push(`plugins/${name}: folder name must be lowercase [a-z0-9_-]`); continue; }
  let m;
  try { m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")); } catch (e) { errors.push(`plugins/${name}/manifest.json: ${e.message}`); continue; }
  const bad = problems(m, dir);
  if (bad.length) { errors.push(...bad.map((b) => `plugins/${name}/manifest.json: ${b}`)); continue; }
  const folder = `${REPO_URL}/tree/${REF}/plugins/${name}`;
  const iconFile = m.icon && existsSync(join(dir, m.icon)) ? m.icon : null;
  plugins.push({
    name,
    id: m.id,
    title: m.name,
    version: m.version,
    description: m.description ?? "",
    methods: m.provides?.includes("wallet") ? (m.wallet?.methods ?? []) : [],
    hosts: m.permissions?.hosts ?? [],
    secrets: m.permissions?.secrets === true,
    webLogin: m.permissions?.webLogin?.url ? hostOf(m.permissions.webLogin.url) : null,
    pollSec: m.background?.pollSec ? Math.max(15, m.background.pollSec) : 0,
    source: folder,
    install: "lawallet:plugin?url=" + encodeURIComponent(folder),
    icon: iconFile ? `icons/${name}${iconFile.slice(iconFile.lastIndexOf("."))}` : null,
    iconSrc: iconFile ? join(dir, iconFile) : null,
  });
}
if (errors.length) {
  console.error("Invalid plugins (the app would skip these):\n  " + errors.join("\n  "));
  process.exit(1);
}

// ---------- render ----------
const icon = (p, cls = "p-icon") => p.icon
  ? `<span class="${cls}"><img src="${esc(p.icon)}" alt="" width="56" height="56" loading="lazy"></span>`
  : `<span class="${cls}">${esc(p.title[0])}</span>`;
const svg = (id) => `<svg class="i" aria-hidden="true"><use href="#i-${id}"/></svg>`;

function perms(p) {
  const li = [];
  for (const h of p.hosts) li.push(`<li>${svg("globe")}<span>Connects to <b>${esc(h)}</b></span></li>`);
  if (p.webLogin) li.push(`<li>${svg("key")}<span>Sign-in at <b>${esc(p.webLogin)}</b>, the password never reaches LaWallet</span></li>`);
  if (p.secrets) li.push(`<li>${svg("lock")}<span>Keeps its login on the device, encrypted</span></li>`);
  if (p.pollSec) li.push(`<li>${svg("clock")}<span>Checks for payments every ${p.pollSec} s</span></li>`);
  return li.length ? li.join("") : `<li>${svg("shield")}<span>No network, secrets or sign-in</span></li>`;
}
/** The app's own sheet wording (values/strings.xml plugins_perm_*), for the phone mock. */
function sheetPerms(p) {
  const li = p.hosts.map((h) => `<li>Connects to ${esc(h)}</li>`);
  if (p.webLogin) li.push(`<li>Asks you to sign in at ${esc(p.webLogin)}</li>`);
  if (p.secrets) li.push("<li>Keeps your login on this device, encrypted</li>");
  if (p.pollSec) li.push(`<li>Checks for payments every ${p.pollSec} seconds</li>`);
  return li.join("");
}

function card(p, i) {
  const methods = [...NIP47, ...p.methods.filter((m) => !NIP47.includes(m))]
    .map((m) => p.methods.includes(m) ? `<li>${esc(m)}</li>` : `<li class="off" title="Not declared in manifest.json">${esc(m)}</li>`)
    .join("");
  return `<article class="plugin" data-plugin="${esc(p.id)}" data-reveal style="--d:${i}">
  <div class="flip">
    <div class="face front spotlight">
      <div class="p-head">
        ${icon(p)}
        <div class="p-title">
          <h3>${esc(p.title)}</h3>
          <div class="p-meta"><span class="ver">v${esc(p.version)}</span><span>${esc(p.id)}</span></div>
        </div>
        <button class="qr-mini" type="button" data-flip data-qr="${esc(p.install)}" aria-label="Show the install QR code for ${esc(p.title)}"></button>
      </div>
      <p class="p-desc">${esc(p.description)}</p>
      <div><div class="p-label">Wallet methods</div><ul class="methods">${methods}</ul></div>
      <div><div class="p-label">Permissions</div><ul class="perms">${perms(p)}</ul></div>
      <div class="p-foot">
        <button class="btn btn-primary" type="button" data-flip>${svg("qr")}<span>Scan to install</span></button>
        <a class="btn btn-ghost" href="${esc(p.source)}">${svg("code")}<span>Source</span></a>
      </div>
    </div>
    <div class="face back spotlight" aria-hidden="true">
      <div class="qr-big" data-qr="${esc(p.install)}"></div>
      <h3>Scan with LaWallet</h3>
      <p>Open the scanner in LaWallet for Android (debug build) and point it here. You'll review its permissions before anything installs.</p>
      <div class="linkbox"><code title="${esc(p.install)}">${esc(p.install)}</code><button class="icon-btn" type="button" data-copy="${esc(p.install)}" data-copy-msg="Install link copied" aria-label="Copy install link">${svg("copy")}</button></div>
      <div class="back-actions">
        <a class="btn btn-primary" href="${esc(p.install)}">Open in LaWallet</a>
        <button class="btn btn-ghost" type="button" data-copy="${esc(p.source)}" data-copy-msg="GitHub URL copied">Copy GitHub URL</button>
      </div>
      <button class="btn btn-ghost btn-sm" type="button" data-flip-back>${svg("back")}<span>Back</span></button>
    </div>
  </div>
</article>`;
}

const first = plugins[0];
const marquee = ["QuickJS sandbox", "NIP-47 ABI", "Pinned to a commit", "SHA-256 checked", "Host allowlist", "Encrypted secrets", "Web login on the provider's own page", "Scan to install", "No keys shared", "One index.js"];
const marqueeHtml = [...marquee, ...marquee].map((t) => `<span>${esc(t)}</span>`).join("");
const data = plugins.map(({ iconSrc, ...p }) => p);

const vars = {
  REPO_URL: esc(REPO_URL),
  SHA: esc(SHA),
  SHA_SHORT: esc(SHA.slice(0, 7)),
  COUNT: String(plugins.length),
  COUNT_LABEL: plugins.length === 1 ? "plugin listed" : "plugins listed",
  CARDS: plugins.map(card).join("\n"),
  ADD_DELAY: String(plugins.length),
  MARQUEE: marqueeHtml,
  HERO_TILE: first?.icon ? `<img src="${esc(first.icon)}" alt="">` : "",
  FIRST_LINK: esc(first?.install ?? REPO_URL),
  FIRST_SOURCE: esc((first?.source ?? REPO_URL).replace("https://", "")),
  FIRST_NAME: esc(first?.title ?? "Example"),
  FIRST_DESC: esc(first?.description ?? ""),
  FIRST_VERSION: esc(first?.version ?? "0.1.0"),
  FIRST_ICON: first?.icon ? `<img src="${esc(first.icon)}" alt="">` : "",
  FIRST_PERMS: first ? sheetPerms(first) : "",
  CODE_JS: esc(readFileSync(join(ROOT, "template/index.js"), "utf8").trim()),
  CODE_JSON: esc(readFileSync(join(ROOT, "template/manifest.json"), "utf8").trim()),
  DATA: JSON.stringify(data).replace(/</g, "\\u003c"),
};

let html = readFileSync(join(ROOT, "site/index.html"), "utf8");
html = html.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
  if (!(k in vars)) throw new Error(`site/index.html: unknown placeholder ${m}`);
  return vars[k];
});

// ---------- write ----------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "icons"), { recursive: true });
mkdirSync(join(OUT, "assets"), { recursive: true });
writeFileSync(join(OUT, "index.html"), html);
for (const f of ["style.css", "app.js"]) copyFileSync(join(ROOT, "site", f), join(OUT, f));
for (const f of readdirSync(join(ROOT, "site/assets"))) copyFileSync(join(ROOT, "site/assets", f), join(OUT, "assets", f));
for (const p of plugins) if (p.iconSrc) copyFileSync(p.iconSrc, join(OUT, p.icon));
writeFileSync(join(OUT, "plugins.json"), JSON.stringify({ repo: REPO_URL, ref: REF, commit: SHA, plugins: data }, null, 2) + "\n");
writeFileSync(join(OUT, ".nojekyll"), "");
console.log(`Built ${plugins.length} plugin(s) into ${OUT.replace(ROOT + "/", "")}/ (${REPO}@${REF}, ${SHA.slice(0, 7)})`);
