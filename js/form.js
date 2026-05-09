// ============================================
// CLOUDFLARE TURNSTILE CONFIG
// ============================================
// Public site key from dash.cloudflare.com → Turnstile.
// Site keys are PUBLIC — safe to commit. The corresponding secret key
// must be set as TURNSTILE_SECRET_KEY in Netlify env vars.
// Until both are set, forms run with Tier 1 protection only (honeypot
// + time-trap + format validation).
// Temporarily disabled while debugging form issue. To re-enable, change
// back to "0x4AAAAAADKVMJikX-gaT9wf" and restore TURNSTILE_SECRET_KEY
// env var in Netlify.
var TURNSTILE_SITE_KEY = "YOUR_TURNSTILE_SITE_KEY";
var TURNSTILE_ENABLED = TURNSTILE_SITE_KEY && TURNSTILE_SITE_KEY !== "YOUR_TURNSTILE_SITE_KEY";

// ============================================
// UTM & GCLID PARAMETER CAPTURE
// ============================================
(function () {
  var params = new URLSearchParams(window.location.search);
  var trackingKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid"];
  trackingKeys.forEach(function (key) {
    var value = params.get(key) || "";
    if (value) sessionStorage.setItem(key, value);
    var stored = value || sessionStorage.getItem(key) || "";
    document.querySelectorAll('input[name="' + key + '"]').forEach(function (el) {
      el.value = stored;
    });
  });
})();

// ============================================
// CLOUDFLARE TURNSTILE: render widget into each form
// Injects a managed-mode (mostly invisible) challenge before each
// submit button. On submit, Turnstile auto-adds a hidden input
// `cf-turnstile-response` with the verification token, which the
// server verifies via siteverify API.
// ============================================
(function initTurnstile() {
  if (!TURNSTILE_ENABLED) return;

  document.querySelectorAll('[id$="LeadForm"]').forEach(function (form) {
    var btn = form.querySelector('button[type="submit"]');
    if (!btn) return;
    var widget = document.createElement("div");
    widget.className = "cf-turnstile";
    widget.setAttribute("data-sitekey", TURNSTILE_SITE_KEY);
    widget.setAttribute("data-theme", "light");
    widget.style.margin = "16px 0";
    widget.style.display = "flex";
    widget.style.justifyContent = "center";
    btn.parentNode.insertBefore(widget, btn);
  });

  // Load the Turnstile API script
  var script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
})();

// ============================================
// BOT PROTECTION: time-trap
// Stamp formStartedAt on first interaction with any field. Bots that
// dump values via JS without focus/input events leave it blank, and
// the server rejects. Real users always trip a focus or input event.
// ============================================
document.querySelectorAll('[id$="LeadForm"]').forEach(function (form) {
  var startedAtField = form.querySelector('input[name="formStartedAt"]');
  if (!startedAtField) return;
  var marked = false;
  function markStart() {
    if (marked) return;
    marked = true;
    startedAtField.value = String(Date.now());
  }
  form.querySelectorAll("input, select, textarea").forEach(function (field) {
    if (field === startedAtField) return;
    field.addEventListener("focus", markStart);
    field.addEventListener("input", markStart);
  });
});

// ============================================
// FORM SUBMISSION HANDLER
// ============================================
var formSubmitting = false;

var productLabels = {
  "final-expense": "Final Expense",
  "term-life": "Term Life",
  "annuity": "Annuity",
  "iul": "IUL",
  "not-sure": "General",
  "Final Expense": "Final Expense",
  "Term Life": "Term Life",
  "Annuity": "Annuity",
  "IUL": "IUL",
  "Not sure": "General",
};

// Minimum elapsed time before allowing submission. Bots fire instantly;
// even with autofill, real humans take longer than this to click submit.
var MIN_FORM_FILL_MS = 2000;

function showFormError(form, btn, originalText, message) {
  formSubmitting = false;
  btn.disabled = false;
  btn.textContent = originalText;
  var existing = form.querySelector(".form-error");
  if (existing) existing.remove();
  var errorDiv = document.createElement("div");
  errorDiv.className = "form-error";
  errorDiv.textContent = message;
  form.appendChild(errorDiv);
}

function handleFormSubmit(e) {
  e.preventDefault();

  // Prevent duplicate submissions
  if (formSubmitting) return;
  formSubmitting = true;

  var form = e.target;
  var btn = form.querySelector('button[type="submit"]');
  var data = new FormData(form);
  var originalText = btn.textContent;

  // Clear any previous error
  var existingError = form.querySelector(".form-error");
  if (existingError) existingError.remove();

  btn.disabled = true;
  btn.textContent = "Sending...";

  // Turnstile gate: don't submit if challenge hasn't been completed
  if (TURNSTILE_ENABLED) {
    var token = data.get("cf-turnstile-response");
    if (!token) {
      showFormError(form, btn, originalText, "Please complete the security check above.");
      return;
    }
  }

  // Bot protection: enforce min time client-side so fast humans don't
  // see an error — we just stall briefly. Server still validates.
  var startedAt = Number(data.get("formStartedAt")) || 0;
  var elapsedMs = startedAt ? Date.now() - startedAt : 0;
  var remainingDelay = Math.max(0, MIN_FORM_FILL_MS - elapsedMs);

  setTimeout(function () {
    submitLead(form, btn, originalText, data, startedAt);
  }, remainingDelay);
}

function submitLead(form, btn, originalText, data, startedAt) {
  var formElapsedMs = startedAt ? Date.now() - startedAt : 0;
  var conversionValue = parseFloat(data.get("coverageAmount")) || 1.0;

  // Dynamic content name based on product selection
  var contentName = (productLabels[data.get("productInterest")] || "Insurance") + " Quote";

  // Submit to serverless function FIRST, then fire pixels on success
  fetch("/.netlify/functions/lead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: data.get("name"),
      email: data.get("email"),
      phone: data.get("phone"),
      ageRange: data.get("ageRange"),
      coverageAmount: data.get("coverageAmount"),
      productInterest: data.get("productInterest"),
      timeline: data.get("timeline"),
      utm_source: data.get("utm_source"),
      utm_medium: data.get("utm_medium"),
      utm_campaign: data.get("utm_campaign"),
      utm_content: data.get("utm_content"),
      utm_term: data.get("utm_term"),
      gclid: data.get("gclid"),
      // Bot protection signals
      botField: data.get("bot-field") || "",
      formElapsedMs: formElapsedMs,
      turnstileToken: data.get("cf-turnstile-response") || "",
    }),
  })
    .then(function (res) {
      if (!res.ok) throw new Error("Server returned " + res.status);

      // Fire tracking pixels only after successful save
      if (typeof gtag !== "undefined") {
        gtag("set", "user_data", {
          email: data.get("email"),
          phone_number: data.get("phone"),
        });
        gtag("event", "conversion", {
          send_to: "AW-17990540500/4j1WCNi-m4IcENS5x4JD",
          value: conversionValue,
          currency: "USD",
        });
      }

      if (typeof window.uetq !== "undefined") {
        window.uetq.push("event", "submit_lead_form", {
          event_category: "conversion",
          event_label: "final_expense_lead",
          event_value: conversionValue,
        });
      }

      if (typeof fbq !== "undefined") {
        fbq("track", "Lead", {
          content_name: contentName,
          value: conversionValue,
          currency: "USD",
        });
      }

      if (typeof ttq !== "undefined") {
        ttq.track("SubmitForm", {
          content_name: contentName,
        });
      }

      // Wait for pixel requests to complete before navigating away.
      // Without this delay the browser kills outgoing beacon requests
      // on page unload, so Meta/Google/TikTok never receive the event.
      setTimeout(function () {
        window.location.href = "/thank-you.html";
      }, 750);
    })
    .catch(function (err) {
      console.error("Form submission error:", err);
      // Reset Turnstile so user can retry without page reload
      if (TURNSTILE_ENABLED && typeof window.turnstile !== "undefined") {
        try { window.turnstile.reset(); } catch (e) {}
      }
      showFormError(form, btn, originalText, "Something went wrong. Please try again or call us at (312) 203-8106.");
    });
}

// Attach to all forms with id ending in "LeadForm"
document.querySelectorAll('[id$="LeadForm"]').forEach(function (form) {
  form.addEventListener("submit", handleFormSubmit);
});
