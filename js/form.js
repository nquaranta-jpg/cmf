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
      formSubmitting = false;
      btn.disabled = false;
      btn.textContent = originalText;

      var errorDiv = document.createElement("div");
      errorDiv.className = "form-error";
      errorDiv.textContent = "Something went wrong. Please try again or call us at (312) 203-8106.";
      form.appendChild(errorDiv);
    });
}

// Attach to all forms with id ending in "LeadForm"
document.querySelectorAll('[id$="LeadForm"]').forEach(function (form) {
  form.addEventListener("submit", handleFormSubmit);
});
