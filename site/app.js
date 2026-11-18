// LaWallet Plugins landing: reveals, parallax, spotlights, QR codes, card flip, copy, the phone story, code tabs.
// No framework. Everything degrades: without JS the cards, links and docs still work.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;

  // ---------- reveal on scroll ----------
  const io = new IntersectionObserver(
    (es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))),
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  $$("[data-reveal]").forEach((el) => io.observe(el));

  // ---------- scroll + pointer parallax (one rAF loop, eased) ----------
  const nav = $(".nav");
  const stage = $("#stage");
  const hero = $("#hero");
  const speeds = $$("[data-speed]");
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  let ticking = false;

  function frame() {
    ticking = false;
    const y = scrollY;
    nav.classList.toggle("scrolled", y > 8);
    root.style.setProperty("--scroll", y);
    if (!reduced) {
      const p = Math.min(1, Math.max(0, y / (hero.offsetHeight * 0.85)));
      mouse.x += (mouse.tx - mouse.x) * 0.08;
      mouse.y += (mouse.ty - mouse.y) * 0.08;
      stage.style.setProperty("--p", p.toFixed(4));
      stage.style.setProperty("--mx", mouse.x.toFixed(4));
      stage.style.setProperty("--my", mouse.y.toFixed(4));
      for (const el of speeds) {
        const r = el.parentElement.getBoundingClientRect();
        const off = (r.top + r.height / 2 - innerHeight / 2) * Number(el.dataset.speed);
        el.style.translate = `0 ${off.toFixed(1)}px`;
      }
      if (Math.abs(mouse.tx - mouse.x) > 0.001 || Math.abs(mouse.ty - mouse.y) > 0.001) request();
    }
  }
  const request = () => ticking || ((ticking = true), requestAnimationFrame(frame));
  addEventListener("scroll", request, { passive: true });
  addEventListener("resize", request);
  hero.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const r = stage.getBoundingClientRect();
    mouse.tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 1.2)));
    mouse.ty = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 1.2)));
    request();
  });
  hero.addEventListener("pointerleave", () => ((mouse.tx = mouse.ty = 0), request()));
  request();

  // ---------- cursor spotlight on cards ----------
  addEventListener("pointermove", (e) => {
    const el = e.target.closest?.(".spotlight");
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--x", `${e.clientX - r.left}px`);
    el.style.setProperty("--y", `${e.clientY - r.top}px`);
  }, { passive: true });

  // ---------- QR codes: LaWallet-styled, error correction H with the isotype in the middle ----------
  const ISO = '<path fill="#e95052" d="M1003.53,83.69c4.44,0,8.06,3.61,8.06,8.06s-3.61,8.06-8.06,8.06v33.3c22.8,0,41.36-18.55,41.36-41.36,0-9.25-3.06-17.81-8.21-24.71-7.55,10.1-19.6,16.65-33.15,16.65Z"/><path fill="#55b68c" d="M1036.68,67.04c5.16-6.9,8.21-15.45,8.21-24.71,0-22.8-18.55-41.36-41.36-41.36v33.3c4.44,0,8.06,3.61,8.06,8.06s-3.61,8.06-8.06,8.06c13.55,0,25.6,6.55,33.15,16.65Z"/><path fill="#fdc800" d="M1036.68,67.04c-7.55-10.1-19.6-16.65-33.15-16.65h-22.13v33.3h22.13c13.55,0,25.6-6.55,33.15-16.65Z"/>';
  function qrSvg(text) {
    const qr = qrcode(0, "H");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    const box = Math.round(n * 0.24) | 1; // odd, centered; well inside H's 30% recovery
    const b0 = (n - box) / 2;
    const inLogo = (r, c) => r >= b0 - 0.5 && r < b0 + box + 0.5 && c >= b0 - 0.5 && c < b0 + box + 0.5;
    let d = "";
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (qr.isDark(r, c) && !finder(r, c) && !inLogo(r, c)) d += `M${c + 0.06},${r + 0.06}h.88v.88h-.88z`;
    const eye = (x, y) =>
      `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.6" fill="none" stroke="#0a0a0a" stroke-width="1"/>` +
      `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx=".8" fill="#00836d"/>`;
    const s = (box * 0.82) / 134;
    const lx = n / 2 - (66 * s) / 2 - 980 * s;
    const ly = n / 2 - (134 * s) / 2;
    return (
      `<svg viewBox="0 0 ${n} ${n}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QR code">` +
      `<path d="${d}" fill="#0a0a0a"/>${eye(0, 0)}${eye(n - 7, 0)}${eye(0, n - 7)}` +
      `<rect x="${b0}" y="${b0}" width="${box}" height="${box}" rx="${box * 0.22}" fill="#fff"/>` +
      `<g transform="translate(${lx} ${ly}) scale(${s})">${ISO}</g></svg>`
    );
  }
  function renderQrs() {
    if (typeof qrcode !== "function") return false;
    $$("[data-qr]").forEach((el) => (el.innerHTML = qrSvg(el.dataset.qr)));
    return true;
  }
  if (!renderQrs()) addEventListener("load", renderQrs, { once: true });

  // ---------- toast + copy ----------
  const toast = $("#toast");
  let toastTimer;
  function say(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = Object.assign(document.createElement("textarea"), { value: text });
      t.style.cssText = "position:fixed;opacity:0";
      document.body.append(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
  }
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-copy]");
    if (!btn) return;
    await copy(btn.dataset.copy);
    say(btn.dataset.copyMsg || "Copied");
    btn.classList.add("done");
    const use = $("use", btn);
    const was = use?.getAttribute("href");
    if (use && was === "#i-copy") use.setAttribute("href", "#i-check");
    setTimeout(() => (btn.classList.remove("done"), use && was && use.setAttribute("href", was)), 1600);
  });

  // ---------- card flip (front: details, back: big QR) ----------
  function flip(card, on) {
    card.classList.toggle("flipped", on);
    const [front, back] = $$(".face", card);
    front.inert = on;
    back.inert = !on;
    front.setAttribute("aria-hidden", on);
    back.setAttribute("aria-hidden", !on);
    setTimeout(() => (on ? $("[data-flip-back]", back) : $("[data-flip]", front))?.focus({ preventScroll: true }), 350);
  }
  $$(".plugin[data-plugin]").forEach((card) => {
    const back = $(".back", card);
    back.inert = true;
    $$("[data-flip]", card).forEach((b) => b.addEventListener("click", () => flip(card, true)));
    $$("[data-flip-back]", card).forEach((b) => b.addEventListener("click", () => flip(card, false)));
    card.addEventListener("keydown", (e) => e.key === "Escape" && card.classList.contains("flipped") && flip(card, false));
  });

  // ---------- "how it works": steps drive the phone's screens; autoplay where the phone isn't sticky ----------
  const screens = $$("#phone .screen");
  const steps = $$(".step");
  let current = -1;
  function show(i) {
    if (i === current) return;
    current = i;
    screens.forEach((s) => s.classList.toggle("on", Number(s.dataset.screen) === i));
    steps.forEach((s) => s.classList.toggle("on", Number(s.dataset.step) === i));
  }
  show(0);
  const narrow = matchMedia("(max-width: 960px)");
  // The sticky phone always fits the window (desktop); narrow layouts use the fixed zoom in style.css.
  const phone = $("#phone");
  const fit = () => phone.style.setProperty("--fit", Math.min(1, (innerHeight - 150) / (Math.min(330, phone.parentElement.clientWidth) * 19 / 9)).toFixed(3));
  fit();
  addEventListener("resize", fit);
  const stepIo = new IntersectionObserver(
    (es) => !narrow.matches && es.forEach((e) => e.isIntersecting && show(Number(e.target.dataset.step))),
    { rootMargin: "-45% 0px -45% 0px" },
  );
  steps.forEach((s) => stepIo.observe(s));
  let auto;
  const phoneIo = new IntersectionObserver(([e]) => {
    clearInterval(auto);
    if (e.isIntersecting && narrow.matches && !reduced) auto = setInterval(() => show((current + 1) % screens.length), 2600);
  });
  phoneIo.observe(phone);

  // ---------- code tabs + a tiny highlighter ----------
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const JS = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\b(const|let|var|async|await|function|return|if|else|for|of|throw|export|default|new|undefined|null|true|false)\b|\b(\d[\d_.]*)\b|\b([A-Za-z_$][\w$]*)(?=\s*\()/g;
  const JSON_ = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null|-?\d+(?:\.\d+)?)\b/g;
  function highlight(pre) {
    const src = pre.textContent;
    let out = "", last = 0, m;
    const re = pre.dataset.lang === "json" ? JSON_ : JS;
    re.lastIndex = 0;
    while ((m = re.exec(src))) {
      out += esc(src.slice(last, m.index));
      const t = esc(m[0]);
      if (pre.dataset.lang === "json") out += m[2] ? `<span class="tk-p">${esc(m[1])}</span>${esc(m[2])}` : m[1] ? `<span class="tk-s">${t}</span>` : `<span class="tk-n">${t}</span>`;
      else out += m[1] ? `<span class="tk-c">${t}</span>` : m[2] ? `<span class="tk-s">${t}</span>` : m[3] ? `<span class="tk-k">${t}</span>` : m[4] ? `<span class="tk-n">${t}</span>` : `<span class="tk-f">${t}</span>`;
      last = m.index + m[0].length;
    }
    pre.innerHTML = out + esc(src.slice(last));
  }
  $$(".code-body").forEach(highlight);
  $$(".code-tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      $$(".code-tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
      $$(".code-body").forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.tab));
    }),
  );
})();
