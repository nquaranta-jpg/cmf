// ============================================
// CMF Launch — public form handling
// Targets every <form class="launch-form" data-form-type="...">.
// Same bot-protection signals as the consumer funnel (js/form.js):
// honeypot, time-trap, optional Turnstile — verified server-side in
// launch-forms.mjs. Success is shown inline (no thank-you redirect).
// ============================================

(function () {
  var MIN_FORM_FILL_MS = 2000;

  document.querySelectorAll("form.launch-form").forEach(function (form) {
    // Time-trap: stamp first interaction
    var startedAtField = form.querySelector('input[name="formStartedAt"]');
    var marked = false;
    function markStart() {
      if (marked || !startedAtField) return;
      marked = true;
      startedAtField.value = String(Date.now());
    }
    form.querySelectorAll("input, select, textarea").forEach(function (field) {
      if (field === startedAtField) return;
      field.addEventListener("focus", markStart);
      field.addEventListener("input", markStart);
    });

    var submitting = false;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (submitting) return;
      submitting = true;

      var btn = form.querySelector('button[type="submit"]');
      var originalText = btn ? btn.textContent : "";
      var data = new FormData(form);

      var existing = form.querySelector(".form-error");
      if (existing) existing.remove();

      if (btn) {
        btn.disabled = true;
        btn.textContent = "Sending...";
      }

      function fail(message) {
        submitting = false;
        if (btn) {
          btn.disabled = false;
          btn.textContent = originalText;
        }
        var errorDiv = document.createElement("div");
        errorDiv.className = "form-error";
        errorDiv.textContent = message;
        form.appendChild(errorDiv);
      }

      // Stall fast humans instead of erroring (server enforces 1.5s min)
      var startedAt = Number(data.get("formStartedAt")) || 0;
      var elapsed = startedAt ? Date.now() - startedAt : 0;
      var delay = Math.max(0, MIN_FORM_FILL_MS - elapsed);

      setTimeout(function () {
        var payload = {
          formType: form.getAttribute("data-form-type"),
          botField: data.get("bot-field") || "",
          formElapsedMs: startedAt ? Date.now() - startedAt : 0,
          turnstileToken: data.get("cf-turnstile-response") || "",
        };
        data.forEach(function (value, key) {
          if (key === "bot-field" || key === "formStartedAt" || key === "cf-turnstile-response") return;
          payload[key] = value;
        });

        fetch("/.netlify/functions/launch-forms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
          .then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (body) {
              return { ok: res.ok, body: body };
            });
          })
          .then(function (result) {
            if (!result.ok) {
              if (result.body && result.body.errors) {
                fail("Please double-check: " + result.body.errors.join(", ") + ".");
              } else {
                fail("Something went wrong. Please try again or email nquaranta@crownmerchantfinancial.com.");
              }
              return;
            }
            var success = document.createElement("div");
            success.className = "launch-form-success";
            success.textContent = form.getAttribute("data-success-message") || "Got it — we'll be in touch within one business day.";
            form.replaceWith(success);
          })
          .catch(function () {
            fail("Something went wrong. Please try again or email nquaranta@crownmerchantfinancial.com.");
          });
      }, delay);
    });
  });
})();
