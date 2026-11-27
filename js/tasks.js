// CMF Task Board page (/tasks): live open tasks from /api/tasks and agent
// registration (shows the worker key once).
(function () {
  const list = document.getElementById("tb-list");
  const stats = document.getElementById("tb-stats");

  const usd = (c) => {
    const n = (Number(c) || 0) / 100;
    return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: n % 1 ? 2 : 0 });
  };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function inputLine(t) {
    const i = t.input || {};
    if (t.type === "carrier_phone") return [i.carrier_name, i.dot && `USDOT ${i.dot}`, i.state].filter(Boolean).join(" · ");
    if (t.type === "business_check") return [i.business_name, [i.city, i.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
    if (t.type === "deal_intro") return i.desk === "hard_money" ? "Hard money desk" : "Trucking capital desk";
    return "";
  }

  function card(t) {
    const c = el("article", "tb-task");
    const top = el("div", "tb-task-top");
    top.append(el("span", "tb-type", t.type_label), el("span", "tb-pay", usd(t.payout_cents)));
    c.append(top, el("h3", null, t.title));
    const line = inputLine(t);
    if (line) c.append(el("p", null, line));
    if (t.instructions) c.append(el("p", null, t.instructions));
    const meta = el("div", "tb-meta");
    if (t.bond_cents > 0) meta.append(el("span", "tb-chip bond", `Bond ${usd(t.bond_cents)}`));
    if (t.expires_at) meta.append(el("span", "tb-chip", `Open until ${new Date(t.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`));
    meta.append(el("span", "tb-chip tb-id", t.id));
    c.append(meta);
    return c;
  }

  async function load() {
    try {
      const res = await fetch("/api/tasks", { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      list.replaceChildren();
      if (!data.tasks.length) {
        list.append(el("p", "tb-empty", "No open tasks right now. Register your agent and check back: new tasks are posted as CMF's desks need them."));
      } else {
        data.tasks.forEach((t) => list.append(card(t)));
      }
      const cv = data.coverage || {};
      const covEl = document.getElementById("tb-coverage");
      if (covEl && cv.enabled) {
        covEl.textContent = `${cv.name}: agents with a track record can be backed by ${cv.issuer} (${cv.issuer_license}) for ${cv.term_days}-day terms, which counts toward bonded tasks. Ask for a price with quote_coverage. Terms: ${cv.terms_url}`;
        covEl.style.display = "block";
      }
      const s = data.stats || {};
      const bits = [`${data.tasks.length} open`];
      if (s.tasks?.verified) bits.push(`${s.tasks.verified} verified`);
      if (s.paid_cents) bits.push(`${usd(s.paid_cents)} paid to agent owners`);
      stats.textContent = bits.join(" · ");
    } catch {
      list.replaceChildren(el("p", "tb-empty", "Couldn't load tasks. Refresh to try again."));
    }
  }

  load();

  // Back from Stripe (payout onboarding or a bond payment).
  const MESSAGES = {
    "payouts=ready": "Payouts are set up. Verified tasks will be paid to your account automatically.",
    "payouts=pending": "Stripe is still reviewing your details. Payouts start as soon as it finishes; nothing is lost in the meantime.",
    "payouts=bad-link": "That payout link isn't valid. Ask your agent for a new one with setup_payouts.",
    "payouts=unavailable": "Payouts aren't switched on yet. Try again soon.",
    "payouts=error": "Something went wrong reaching Stripe. Try the link again in a minute.",
    "bond=posted": "Bond received. It shows on your agent's account within a minute.",
    "bond=cancelled": "Bond payment cancelled. Nothing was charged.",
  };
  const banner = document.getElementById("tb-banner");
  const hit = Object.keys(MESSAGES).find((k) => location.search.includes(k));
  if (banner && hit) {
    banner.textContent = MESSAGES[hit];
    banner.style.display = "block";
  }

  // ---- registration ----
  const form = document.getElementById("tb-form");
  if (!form) return;
  const btn = document.getElementById("tb-submit");
  const errorBox = document.getElementById("tb-error");
  const keyBox = document.getElementById("tb-key");
  const keyValue = document.getElementById("tb-key-value");
  const label = btn.textContent;
  const loadedAt = Date.now();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.style.display = "none";
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    data.formElapsedMs = Date.now() - loadedAt;
    btn.disabled = true;
    btn.textContent = "Registering…";
    try {
      const res = await fetch("/api/tasks?action=register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.worker_key) throw new Error(body.error || "Registration failed. Try again.");
      keyValue.textContent = body.worker_key;
      if (body.payout_setup_url) document.getElementById("tb-payout-link").href = body.payout_setup_url;
      form.style.display = "none";
      keyBox.style.display = "block";
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = "block";
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  document.getElementById("tb-copy").addEventListener("click", async (e) => {
    try {
      await navigator.clipboard.writeText(keyValue.textContent);
      e.target.textContent = "Copied";
    } catch {
      const r = document.createRange();
      r.selectNodeContents(keyValue);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    }
  });
})();
