// Internal review page for merchant statement submissions.
// Password lives only in sessionStorage for the tab and is sent as the
// x-review-key header; the serverless layer does the actual check.
(function () {
  var API = "/.netlify/functions/merchant-review";
  var KEY_STORAGE = "cmf_review_key";

  var loginCard = document.getElementById("login-card");
  var listView = document.getElementById("list-view");
  var detailView = document.getElementById("detail-view");

  var FIELD_DEFS = [
    ["merchant_name", "Merchant name", "text"],
    ["statement_month", "Statement month", "text"],
    ["processor_name_if_visible", "Processor (if visible)", "text"],
    ["total_card_volume", "Total card volume ($)", "number"],
    ["total_transaction_count", "Transaction count", "number"],
    ["total_fees_charged", "Total fees charged ($)", "number"],
    ["estimated_interchange_cost", "Est. interchange cost ($)", "number"],
    ["effective_rate", "Effective rate (%) — recomputed", "number"],
    ["estimated_fair_total_cost", "Fair total cost ($) — recomputed", "number"],
    ["estimated_annual_savings", "Annual savings ($) — recomputed", "number"],
  ];

  function key() { return sessionStorage.getItem(KEY_STORAGE) || ""; }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "x-review-key": key() }, opts.headers || {});
    return fetch(API + path, opts).then(function (res) {
      if (res.status === 401) {
        sessionStorage.removeItem(KEY_STORAGE);
        show(loginCard);
        hide(listView);
        hide(detailView);
        throw new Error("unauthorized");
      }
      return res;
    });
  }

  function apiJSON(path, opts) {
    return api(path, opts).then(function (res) { return res.json(); });
  }

  function show(el) { el.style.display = ""; }
  function hide(el) { el.style.display = "none"; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(n) {
    return typeof n === "number" ? "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—";
  }

  // ── Login ──
  document.getElementById("login-btn").addEventListener("click", doLogin);
  document.getElementById("pw").addEventListener("keydown", function (e) {
    if (e.key === "Enter") doLogin();
  });

  function doLogin() {
    var pw = document.getElementById("pw").value;
    if (!pw) return;
    sessionStorage.setItem(KEY_STORAGE, pw);
    apiJSON("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login" }),
    }).then(function (res) {
      if (res.ok) {
        hide(loginCard);
        loadList();
      }
    }).catch(function () {
      var err = document.getElementById("login-err");
      err.textContent = "Wrong password (or MERCHANTS_REVIEW_PASSWORD is not set in Netlify).";
      show(err);
    });
  }

  // ── List ──
  document.getElementById("refresh-btn").addEventListener("click", loadList);

  function loadList() {
    hide(detailView);
    show(listView);
    apiJSON("?action=list").then(function (res) {
      var body = document.getElementById("list-body");
      body.innerHTML = "";
      var subs = res.submissions || [];
      document.getElementById("list-empty").style.display = subs.length ? "none" : "";
      subs.forEach(function (s) {
        var tr = document.createElement("tr");
        tr.className = "clickable";
        tr.innerHTML =
          "<td>" + esc(new Date(s.created_at).toLocaleString()) + "</td>" +
          "<td>" + esc(s.business) + "<div class='muted'>" + esc(s.email) + "</div></td>" +
          "<td><span class='status " + esc(s.status) + "'>" + esc(s.status) + "</span></td>" +
          "<td>" + (s.effective_rate != null ? s.effective_rate + "%" : "—") + "</td>" +
          "<td>" + money(s.estimated_annual_savings) + (s.fairly_priced ? " 🤝" : "") + "</td>" +
          "<td>" + esc(s.confidence || "—") + "</td>";
        tr.addEventListener("click", function () { loadDetail(s.id); });
        body.appendChild(tr);
      });
    }).catch(function () {});
  }

  // ── Detail ──
  function loadDetail(id) {
    apiJSON("?action=get&id=" + encodeURIComponent(id)).then(function (res) {
      if (!res.ok) return;
      renderDetail(res.submission);
    }).catch(function () {});
  }

  function renderDetail(sub) {
    hide(listView);
    show(detailView);
    var a = sub.analysis_override || sub.analysis || {};
    var c = sub.contact || {};

    var html =
      "<a class='back' id='back-link'>&larr; Back to list</a>" +
      "<div class='card'>" +
      "<h2 style='margin-top:0;'>" + esc(c.business) + " <span class='status " + esc(sub.status) + "'>" + esc(sub.status) + "</span></h2>" +
      "<p class='muted'>" + esc(c.name) + " · <a style='color:var(--gold-light)' href='mailto:" + esc(c.email) + "'>" + esc(c.email) + "</a> · " + esc(c.phone) +
      " · volume: " + esc(c.volume) + " · received " + esc(new Date(sub.created_at).toLocaleString()) + "</p>" +
      (sub.analysis_error ? "<p class='err'>Automated analysis error: " + esc(sub.analysis_error) + "</p>" : "") +
      "<h2>Uploaded files</h2><div class='filelinks' id='file-links'></div>" +
      "<h2>Numbers (edit, then Save, then Approve)</h2><div class='grid2' id='field-grid'></div>" +
      "<label>Red flags (one per line)</label><textarea id='f-red-flags' rows='4'>" + esc((a.red_flags || []).join("\n")) + "</textarea>" +
      "<div class='grid3'>" +
      "<div><label>Fairly priced?</label><select id='f-fairly'><option value='false'" + (!a.fairly_priced ? " selected" : "") + ">No</option><option value='true'" + (a.fairly_priced ? " selected" : "") + ">Yes</option></select></div>" +
      "<div><label>Model confidence</label><input disabled value='" + esc((sub.analysis && sub.analysis.confidence) || "n/a") + "' /></div>" +
      "<div><label>Pages</label><input disabled value='" + (sub.files || []).length + "' /></div>" +
      "</div>" +
      "<label>Confidence note (from the model)</label><textarea disabled rows='2'>" + esc((sub.analysis && sub.analysis.confidence_note) || "") + "</textarea>" +
      "<label>Internal notes</label><textarea id='f-notes' rows='3'>" + esc(sub.notes || "") + "</textarea>" +
      "<div class='actions'>" +
      "<button id='save-btn' class='ghost'>Save edits</button>" +
      "<button id='onepager-btn' class='ghost'>Preview one-pager</button>" +
      "<button id='rerun-btn' class='ghost'>Re-run analysis</button>" +
      "<button id='approve-btn'>Approve</button>" +
      "<button id='reject-btn' class='danger'>Reject</button>" +
      "</div>" +
      "<p class='muted' style='margin-top:0.75rem;'>Approving does not send anything to the prospect. It marks the analysis ready so you can deliver it manually by email.</p>" +
      "<div class='okmsg' id='detail-ok' style='display:none;'></div>" +
      "<div class='err' id='detail-err' style='display:none;'></div>" +
      "<h2>Raw extraction</h2><pre>" + esc(JSON.stringify(sub.analysis, null, 2)) + "</pre>" +
      "</div>";

    detailView.innerHTML = html;

    // Field inputs
    var grid = document.getElementById("field-grid");
    FIELD_DEFS.forEach(function (def) {
      var wrapper = document.createElement("div");
      var label = document.createElement("label");
      label.textContent = def[1];
      var input = document.createElement("input");
      input.type = def[2];
      if (def[2] === "number") input.step = "any";
      input.id = "f-" + def[0];
      var v = a[def[0]];
      input.value = v == null ? "" : v;
      wrapper.appendChild(label);
      wrapper.appendChild(input);
      grid.appendChild(wrapper);
    });

    // File links — fetched with the auth header, opened as blob URLs so the
    // review key never rides on a URL.
    var linksEl = document.getElementById("file-links");
    (sub.files || []).forEach(function (f) {
      var link = document.createElement("a");
      link.href = "#";
      link.textContent = "📄 " + f.name;
      link.addEventListener("click", function (e) {
        e.preventDefault();
        api("?action=file&id=" + encodeURIComponent(sub.id) + "&index=" + f.index)
          .then(function (res) { return res.blob(); })
          .then(function (blob) { window.open(URL.createObjectURL(blob), "_blank"); });
      });
      linksEl.appendChild(link);
    });

    document.getElementById("back-link").addEventListener("click", loadList);
    document.getElementById("save-btn").addEventListener("click", function () { saveEdits(sub, false); });
    document.getElementById("approve-btn").addEventListener("click", function () {
      saveEdits(sub, true).then(function () { return postAction("approve", sub.id); }).then(function () { loadDetail(sub.id); });
    });
    document.getElementById("reject-btn").addEventListener("click", function () {
      postAction("reject", sub.id).then(function () { loadDetail(sub.id); });
    });
    document.getElementById("rerun-btn").addEventListener("click", function () {
      postAction("rerun", sub.id).then(function () {
        flash("Re-running. Refresh in a minute or two.", true);
      });
    });
    document.getElementById("onepager-btn").addEventListener("click", function () {
      window.open("/merchants/onepager?id=" + encodeURIComponent(sub.id), "_blank");
    });
  }

  function collectOverrides() {
    var overrides = {};
    FIELD_DEFS.forEach(function (def) {
      var el = document.getElementById("f-" + def[0]);
      if (!el) return;
      var raw = el.value.trim();
      if (def[2] === "number") overrides[def[0]] = raw === "" ? null : Number(raw);
      else overrides[def[0]] = raw === "" ? null : raw;
    });
    overrides.red_flags = document.getElementById("f-red-flags").value
      .split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    overrides.fairly_priced = document.getElementById("f-fairly").value === "true";
    return overrides;
  }

  function saveEdits(sub, silent) {
    return apiJSON("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        id: sub.id,
        overrides: collectOverrides(),
        notes: document.getElementById("f-notes").value,
      }),
    }).then(function (res) {
      if (!silent) {
        if (res.ok) flash("Saved. Derived numbers were recomputed server-side.", true);
        else flash("Save failed: " + (res.reason || "unknown"), false);
      }
      return res;
    });
  }

  function postAction(action, id) {
    return apiJSON("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: action, id: id }),
    });
  }

  function flash(msg, ok) {
    var okEl = document.getElementById("detail-ok");
    var errEl = document.getElementById("detail-err");
    if (!okEl || !errEl) return;
    hide(okEl); hide(errEl);
    var el = ok ? okEl : errEl;
    el.textContent = msg;
    show(el);
  }

  // ── Boot ──
  hide(listView);
  hide(detailView);
  if (key()) {
    hide(loginCard);
    loadList();
  }
})();
