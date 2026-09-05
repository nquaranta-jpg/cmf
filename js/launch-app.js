// ============================================
// CMF Launch — client platform (login + dashboard)
// Vanilla JS matching the site's no-build convention. Talks to
// /.netlify/functions/launch-api with an HMAC session token kept in
// localStorage. Used by /launch/login and /launch/app.
// ============================================

(function () {
  var API = "/.netlify/functions/launch-api";
  var TOKEN_KEY = "cmfLaunchToken";

  function token() { return localStorage.getItem(TOKEN_KEY) || ""; }

  function money(n) {
    return "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s === null || s === undefined ? "" : String(s);
    return d.innerHTML;
  }

  var TYPE_LABELS = {
    final_expense: "Final Expense",
    term_life: "Term Life",
    iul: "IUL",
    mortgage_protection: "Mortgage Protection",
    veteran: "Veteran",
    annuity: "Annuity",
  };
  var PLAN_LABELS = {
    leads_starter: "Leads — Starter",
    leads_pro: "Leads — Pro",
    leads_elite: "Leads — Elite",
    ads_managed: "Managed Meta Ads",
    training: "One-on-One Training",
  };
  var STATUSES = ["new", "contacted", "appointment", "sold", "dead"];

  function toast(msg) {
    var el = document.getElementById("appToast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  // ── Login page ──
  var loginForm = document.getElementById("launchLoginForm");
  if (loginForm) {
    if (token()) {
      // Already signed in — go straight to the app; the app kicks back
      // here if the token is stale.
      window.location.href = "/launch/app";
      return;
    }
    loginForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = loginForm.querySelector('button[type="submit"]');
      var errEl = document.getElementById("loginError");
      errEl.style.display = "none";
      btn.disabled = true;
      btn.textContent = "Signing in...";
      fetch(API + "?action=login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: document.getElementById("loginEmail").value,
          password: document.getElementById("loginPassword").value,
        }),
      })
        .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, body: b }; }); })
        .then(function (r) {
          if (!r.ok) throw new Error(r.body.error || "Sign-in failed.");
          localStorage.setItem(TOKEN_KEY, r.body.token);
          window.location.href = "/launch/app";
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = "Sign In";
          errEl.textContent = err.message;
          errEl.style.display = "block";
        });
    });
    return;
  }

  // ── Dashboard page ──
  var shell = document.getElementById("appShell");
  if (!shell) return;

  if (!token()) {
    window.location.href = "/launch/login";
    return;
  }

  var state = { client: null, leads: [], spend: [], demo: false, filter: "all" };

  function signOut() {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = "/launch/login";
  }
  document.getElementById("appSignOut").addEventListener("click", signOut);

  // Tabs
  document.querySelectorAll(".app-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".app-tab").forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      document.querySelectorAll(".app-view").forEach(function (v) { v.style.display = "none"; });
      document.getElementById("view-" + tab.getAttribute("data-view")).style.display = "";
    });
  });

  fetch(API + "?action=bootstrap", { headers: { Authorization: "Bearer " + token() } })
    .then(function (res) {
      if (res.status === 401) { signOut(); throw new Error("unauthorized"); }
      return res.json();
    })
    .then(function (data) {
      state.client = data.client;
      state.leads = data.leads || [];
      state.spend = data.spend || [];
      state.demo = !!data.demo;
      render();
    })
    .catch(function (err) {
      if (err.message !== "unauthorized") {
        document.getElementById("appLoading").textContent = "Could not load your dashboard. Refresh to retry.";
      }
    });

  function render() {
    var loadingWrap = document.getElementById("appLoadingWrap");
    if (loadingWrap) loadingWrap.style.display = "none";
    shell.style.display = "";
    document.getElementById("appClientName").textContent = state.client.full_name || state.client.email;
    document.getElementById("appAgency").textContent = state.client.agency_name || "";
    if (state.demo) document.getElementById("appDemoBanner").style.display = "";
    renderLeads();
    renderSpend();
    renderAccount();
  }

  // ── Lead inbox ──
  function renderLeads() {
    var counts = { all: state.leads.length };
    STATUSES.forEach(function (s) {
      counts[s] = state.leads.filter(function (l) { return l.status === s; }).length;
    });
    var filters = document.getElementById("leadFilters");
    filters.innerHTML = ["all"].concat(STATUSES).map(function (s) {
      var label = s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1);
      return '<button class="app-filter' + (state.filter === s ? " active" : "") + '" data-filter="' + s + '">' +
        label + " (" + counts[s] + ")</button>";
    }).join("");
    filters.querySelectorAll(".app-filter").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.filter = btn.getAttribute("data-filter");
        renderLeads();
      });
    });

    var rows = state.leads.filter(function (l) {
      return state.filter === "all" || l.status === state.filter;
    });

    var tbody = document.getElementById("leadRows");
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="app-empty">No leads here yet.</div></td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (l) {
      var date = l.received_at ? new Date(l.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
      return "<tr data-id=\"" + esc(l.id) + "\">" +
        '<td><span class="lead-name">' + esc(l.name || "—") + '</span><br><span class="lead-contact">' + esc(l.phone) + (l.phone && l.email ? " · " : "") + esc(l.email) + "</span></td>" +
        "<td>" + esc(TYPE_LABELS[l.lead_type] || l.lead_type) + (l.state ? ' <span class="lead-contact">(' + esc(l.state) + ")</span>" : "") + "</td>" +
        "<td>" + date + "</td>" +
        '<td><select class="lead-status" data-status="' + esc(l.status) + '">' +
        STATUSES.map(function (s) {
          return '<option value="' + s + '"' + (s === l.status ? " selected" : "") + ">" + s.charAt(0).toUpperCase() + s.slice(1) + "</option>";
        }).join("") +
        "</select></td>" +
        '<td><input class="lead-notes-input" placeholder="Notes..." value="' + esc(l.notes || "") + '"></td>' +
        "</tr>";
    }).join("");

    tbody.querySelectorAll("tr").forEach(function (tr) {
      var id = tr.getAttribute("data-id");
      var lead = state.leads.find(function (l) { return String(l.id) === id; });
      var select = tr.querySelector(".lead-status");
      select.addEventListener("change", function () {
        select.setAttribute("data-status", select.value);
        saveLead(id, { status: select.value }, function () {
          lead.status = select.value;
          renderLeads();
          toast("Status updated");
        });
      });
      var notes = tr.querySelector(".lead-notes-input");
      notes.addEventListener("change", function () {
        saveLead(id, { notes: notes.value }, function () {
          lead.notes = notes.value;
          toast("Notes saved");
        });
      });
    });
  }

  function saveLead(id, fields, onDone) {
    var body = { id: id };
    for (var k in fields) body[k] = fields[k];
    fetch(API + "?action=update-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        if (res.status === 401) { signOut(); return; }
        if (!res.ok) throw new Error();
        onDone();
      })
      .catch(function () { toast("Save failed — try again"); });
  }

  // ── Ad spend ──
  function renderSpend() {
    var now = new Date();
    var monthKey = now.toISOString().slice(0, 7);
    var monthEntries = state.spend.filter(function (e) { return String(e.entry_date).slice(0, 7) === monthKey; });
    var monthSpend = monthEntries.reduce(function (a, e) { return a + Number(e.spend); }, 0);
    var monthLeads = monthEntries.reduce(function (a, e) { return a + Number(e.leads_count); }, 0);
    var budget = Number(state.client.monthly_ad_budget) || 0;

    document.getElementById("statSpend").textContent = money(monthSpend);
    document.getElementById("statBudget").textContent = budget ? money(budget) : "—";
    document.getElementById("statLeads").textContent = String(monthLeads);
    document.getElementById("statCpl").textContent = monthLeads ? money(monthSpend / monthLeads) : "—";
    var pace = budget ? Math.round((monthSpend / budget) * 100) + "% of budget used" : "No budget set";
    document.getElementById("statPace").textContent = pace;

    drawChart(state.spend);
  }

  // Dependency-free SVG chart: gold bars = daily spend, navy line = leads
  function drawChart(entries) {
    var svg = document.getElementById("spendChart");
    if (!entries.length) {
      svg.outerHTML = '<div class="app-empty">No spend recorded yet.</div>';
      return;
    }
    var W = 900, H = 260, padL = 48, padR = 40, padT = 14, padB = 30;
    var iw = W - padL - padR, ih = H - padT - padB;
    var maxSpend = Math.max.apply(null, entries.map(function (e) { return Number(e.spend); })) * 1.15 || 1;
    var maxLeads = Math.max.apply(null, entries.map(function (e) { return Number(e.leads_count); })) * 1.25 || 1;
    var n = entries.length;
    var bw = Math.max(1.5, (iw / n) * 0.62);

    var parts = [];
    // gridlines + left axis labels (spend)
    for (var g = 0; g <= 4; g++) {
      var gy = padT + ih - (ih * g) / 4;
      var gv = (maxSpend * g) / 4;
      parts.push('<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="#e2e8f0" stroke-width="1"/>');
      parts.push('<text x="' + (padL - 6) + '" y="' + (gy + 3) + '" text-anchor="end" font-size="9" fill="#64748b">$' + Math.round(gv) + "</text>");
    }
    // bars
    entries.forEach(function (e, i) {
      var x = padL + (iw * i) / n + ((iw / n) - bw) / 2;
      var h = (Number(e.spend) / maxSpend) * ih;
      parts.push('<rect x="' + x.toFixed(1) + '" y="' + (padT + ih - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="#144aa5" opacity="0.85"><title>' + e.entry_date + ": $" + e.spend + "</title></rect>");
    });
    // leads line
    var pts = entries.map(function (e, i) {
      var x = padL + (iw * i) / n + (iw / n) / 2;
      var y = padT + ih - (Number(e.leads_count) / maxLeads) * ih;
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    parts.push('<polyline points="' + pts.join(" ") + '" fill="none" stroke="#08225a" stroke-width="1.8"/>');
    // right axis (leads)
    for (var g2 = 0; g2 <= 4; g2++) {
      var gy2 = padT + ih - (ih * g2) / 4;
      parts.push('<text x="' + (W - padR + 6) + '" y="' + (gy2 + 3) + '" font-size="9" fill="#64748b">' + Math.round((maxLeads * g2) / 4) + "</text>");
    }
    // x labels: first, middle, last
    [0, Math.floor(n / 2), n - 1].forEach(function (i) {
      var x = padL + (iw * i) / n + (iw / n) / 2;
      var d = new Date(entries[i].entry_date + "T00:00:00");
      parts.push('<text x="' + x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="9" fill="#64748b">' + d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + "</text>");
    });

    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.innerHTML = parts.join("");
  }

  // ── Account ──
  function renderAccount() {
    document.getElementById("acctEmail").textContent = state.client.email;
    document.getElementById("acctPlan").textContent = PLAN_LABELS[state.client.plan] || state.client.plan;
    document.getElementById("acctBilling").textContent = (state.client.billing_status || "active") + " (billing integration coming soon)";
    document.getElementById("acctBudget").textContent = state.client.monthly_ad_budget ? money(state.client.monthly_ad_budget) + " / month" : "—";
  }
})();
