// ============================================
// PICK YOUR POLICY — quote wizard
// Self-contained: this page does NOT load form.js, so UTM capture,
// bot protection, and submission are all handled here (same rules
// as form.js so lead.mjs accepts submissions from both).
// ============================================

// Same Turnstile config as form.js — keep the two in sync. If the
// site key is re-enabled there, re-enable it here too.
var TURNSTILE_SITE_KEY = "YOUR_TURNSTILE_SITE_KEY";
var TURNSTILE_ENABLED = TURNSTILE_SITE_KEY && TURNSTILE_SITE_KEY !== "YOUR_TURNSTILE_SITE_KEY";

// ============================================
// AMERICO RATE DATA (researched July 2026)
//
// Each entry is [low, high] across the age band, so the estimate is an
// honest exact-age range, not a fudge factor.
//
// TERM — Americo Instant Decision Term, "Term 100" full guarantee
// (Policy Series 302). Exact figures from Americo's published Rate
// Guide (doc 23-011-6): annual rate per $1,000, UNISEX, by exact age;
// [low, high] = rates at the youngest/oldest age in each band.
//   monthly = ((face/1000 × rate) + $90 policy fee) × 0.095
// Issue ages 20–75; per-term caps: 15yr→75, 20yr→70, 25yr→65, 30yr→60.
// A band is present only if the whole band is within the issue-age cap.
//
// FINAL EXPENSE — Americo Eagle Select 1 (level benefit). Americo only
// publishes one anchor ($54.15/mo male 65 $10k non-nicotine); rates
// below are the verified Eagle Premier table scaled by the official
// anchor ratio (0.8174) — estimates, monthly rate per $1,000 by gender.
//   monthly = (face/1000 × rate) + $3.80/mo policy fee ($40/yr × 0.095)
// The 40-49 band is extrapolated below the published table.
// Issue ages 40–85. Tobacco: Americo's Quit Smoking Advantage means
// smokers PAY NON-NICOTINE RATES for policy years 1–3, so the estimate
// shows non-nicotine pricing with an explanatory note.
//
// IUL — Americo Instant Decision IUL (Series 336). Derived from
// Americo's own illustrative premium table (spec flyer 23-084-5):
// monthly rate per $1,000 by gender, non-nicotine, interpolated at the
// band edges; <30 and >60 are extrapolated.
//   monthly = (face/1000 × rate) + $5.38/mo policy fee
// Issue ages 18–70. Nicotine rates unpublished → ×1.7 estimate.
//
// ANNUITY — Americo Platinum Assure 5 (5-yr MYGA). Guaranteed rate
// from Americo's official rate card. Minimum premium $25,000.
// UPDATE ANNUITY_RATE WHEN AMERICO REPRICES (check RateCard.pdf).
// ============================================
var TERM_RATES = {
  "15": {
    "18-29": [1.14, 1.23, 2.15, 2.29],
    "30-39": [1.23, 2.18, 2.44, 4.70],
    "40-49": [2.39, 5.39, 5.07, 10.64],
    "50-54": [5.87, 8.17, 11.47, 14.92],
    "55-59": [8.74, 11.29, 15.83, 19.82],
    "60-64": [11.93, 19.02, 20.79, 37.67],
    "65-69": [20.14, 30.58, 43.70, 56.31],
    "70-74": [34.00, 54.28, 60.00, 102.95],
  },
  "20": {
    "18-29": [1.30, 1.61, 2.33, 2.79],
    "30-39": [1.69, 3.00, 2.92, 5.78],
    "40-49": [3.20, 6.61, 6.20, 13.01],
    "50-54": [7.11, 10.17, 13.83, 18.86],
    "55-59": [10.93, 17.82, 20.13, 32.25],
    "60-64": [20.14, 24.92, 36.29, 46.86],
    "65-69": [26.30, 41.09, 50.00, 71.35],
  },
  "25": {
    "18-29": [1.80, 2.19, 2.72, 3.27],
    "30-39": [2.28, 3.79, 3.41, 6.84],
    "40-49": [4.04, 8.80, 7.32, 14.89],
    "50-54": [9.53, 13.19, 15.93, 22.16],
    "55-59": [14.32, 22.52, 24.08, 35.76],
    "60-64": [25.30, 31.94, 39.56, 50.12],
  },
  "30": {
    "18-29": [1.91, 2.24, 3.10, 3.92],
    "30-39": [2.33, 4.10, 4.13, 8.19],
    "40-49": [4.41, 9.85, 8.84, 18.54],
    "50-54": [10.83, 15.05, 20.07, 27.75],
    "55-59": [16.34, 25.82, 30.10, 46.52],
  },
};
var TERM_POLICY_FEE = 90;      // annual, added before the modal factor
var TERM_MODAL_MONTHLY = 0.095;

var FE_RATES = {
  male: {
    "40-49": [2.12, 2.96],
    "50-54": [2.96, 3.49],
    "55-59": [3.49, 3.95],
    "60-64": [3.95, 5.04],
    "65-69": [5.04, 6.76],
    "70-74": [6.76, 9.34],
    "75-79": [9.34, 13.83],
    "80-85": [13.83, 18.95],
  },
  female: {
    "40-49": [1.94, 2.48],
    "50-54": [2.48, 2.79],
    "55-59": [2.79, 3.07],
    "60-64": [3.07, 4.01],
    "65-69": [4.01, 5.05],
    "70-74": [5.05, 6.79],
    "75-79": [6.79, 10.73],
    "80-85": [10.73, 15.77],
  },
};
var FE_MONTHLY_FEE = 3.80;

var IUL_RATES = {
  male: {
    "18-29": [0.16, 0.31],
    "30-39": [0.33, 0.58],
    "40-49": [0.61, 1.12],
    "50-54": [1.17, 1.60],
    "55-59": [1.70, 2.13],
    "60-64": [2.23, 2.89],
    "65-69": [3.08, 3.98],
  },
  female: {
    "18-29": [0.14, 0.25],
    "30-39": [0.27, 0.44],
    "40-49": [0.46, 0.79],
    "50-54": [0.83, 1.14],
    "55-59": [1.22, 1.54],
    "60-64": [1.62, 2.11],
    "65-69": [2.25, 2.94],
  },
};
var IUL_MONTHLY_FEE = 5.38;
var IUL_TOBACCO_FACTOR = 1.7; // nicotine rates unpublished — estimate

var ANNUITY_RATE = 0.0545;    // Platinum Assure 5, official rate card July 1, 2026
var ANNUITY_RATE_ASOF = "July 2026";
var ANNUITY_YEARS = 5;

var AGE_BANDS = ["18-29", "30-39", "40-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79", "80-85"];

var PRODUCTS = {
  "final-expense": {
    name: "Final Expense Insurance",
    subtitle: "Eagle Select • Whole Life",
    blurb: "Affordable whole life insurance built to cover funeral costs, medical bills, and final debts — so your family grieves without a bill in their hands.",
    features: ["No medical exam — just a few health questions", "$5,000–$50,000 in coverage", "Your rate is locked for life and never increases", "Coverage never expires as long as you pay premiums"],
    minAge: 2, maxAge: 9, // 40–85
    eligibilityLabel: "Ages 40–85",
    coverageMin: 5000, coverageMax: 50000, coverageStep: 1000, coverageDefault: 10000,
    coverageTitle: "How much final expense coverage?",
    coverageSub: "The average funeral in the U.S. costs $8,000–$12,000. Most families choose $10,000–$15,000.",
  },
  "term-life": {
    name: "Term Life Insurance",
    subtitle: "Instant Decision Term Series",
    blurb: "Straightforward protection for the years your family depends on your income. Big coverage, level premiums, prices that fit a real budget.",
    features: ["Instant decision — no waiting weeks for approval", "15, 20, 25 & 30 year terms", "Level premiums that never increase during your term", "Up to $450,000 with no medical exam"],
    minAge: 0, maxAge: 7, // issue ages 20–75
    eligibilityLabel: "Ages 20–75",
    coverageMin: 25000, coverageMax: 450000, coverageStep: 5000, coverageDefault: 250000,
    coverageTitle: "How much protection does your family need?",
    coverageSub: "A common rule of thumb is 10× your annual income. $450,000 is the instant-decision maximum — need more? We shop other carriers too.",
  },
  "iul": {
    name: "Indexed Universal Life (IUL)",
    subtitle: "Instant Decision IUL",
    blurb: "Permanent life insurance that builds cash value linked to market index gains — with a floor so you never lose value in a down year.",
    features: ["Market-linked growth with downside protection", "Tax-advantaged cash value you can access while living", "Living benefits for serious illness included at no cost", "No medical exam up to $450,000"],
    minAge: 0, maxAge: 6, // 18–70
    eligibilityLabel: "Ages 18–70",
    coverageMin: 50000, coverageMax: 450000, coverageStep: 5000, coverageDefault: 100000,
    coverageTitle: "How much coverage do you want to build on?",
    coverageSub: "Your death benefit is the foundation — cash value grows alongside it. Most clients start between $100,000 and $250,000.",
  },
  "annuity": {
    name: "Fixed Annuity",
    subtitle: "5-Year Guaranteed Rate Annuity",
    blurb: "A guaranteed, tax-deferred growth vehicle for money you've already saved. Your principal is protected — zero market risk, a rate you can count on.",
    features: ["Guaranteed interest rate locked for the full 5-year term", "Tax-deferred growth — no taxes until withdrawal", "Principal 100% protected from market losses", "Withdraw up to 5% per year penalty-free"],
    minAge: 0, maxAge: 9,
    eligibilityLabel: "All ages",
    coverageMin: 25000, coverageMax: 500000, coverageStep: 5000, coverageDefault: 50000,
    coverageTitle: "How much would you like to grow?",
    coverageSub: "The minimum deposit is $25,000 — best for savings you won't need for the next 5 years, like money sitting in a low-interest account.",
  },
};

// ============================================
// STATE
// ============================================
var state = {
  goal: null,
  product: null,
  matchNote: null,
  ageRange: null,
  gender: null,
  tobacco: null,
  coverage: null,
  termLength: null,
  estimateLow: null,
  estimateHigh: null,
  estimateLabel: null,
};
var currentStep = 1;

function $(id) { return document.getElementById(id); }
function fmtMoney(n) { return "$" + Number(n).toLocaleString(); }
function ageIdx() { return AGE_BANDS.indexOf(state.ageRange); }
function isEligible(productKey, idx) {
  var p = PRODUCTS[productKey];
  return idx >= p.minAge && idx <= p.maxAge;
}

// ============================================
// STEP NAVIGATION
// ============================================
var stepHistory = [];

function showStep(n) {
  document.querySelectorAll(".qz-step").forEach(function (el) {
    el.classList.toggle("active", Number(el.dataset.step) === n);
  });
  document.querySelectorAll(".qz-progress-step").forEach(function (el) {
    var s = Number(el.dataset.step);
    el.classList.toggle("active", s === n);
    el.classList.toggle("done", s < n);
  });
  currentStep = n;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function goTo(n) {
  stepHistory.push(currentStep);
  if (n === 3) renderMatch();
  if (n === 4) renderCoverage();
  if (n === 5) renderSummary();
  showStep(n);
}

document.querySelectorAll("[data-back]").forEach(function (btn) {
  btn.addEventListener("click", function () {
    var prev = stepHistory.pop() || Math.max(1, currentStep - 1);
    showStep(prev);
  });
});

// ============================================
// STEP 1: GOAL
// ============================================
$("qzGoals").querySelectorAll(".qz-option").forEach(function (btn) {
  btn.addEventListener("click", function () {
    $("qzGoals").querySelectorAll(".qz-option").forEach(function (b) { b.classList.remove("selected"); });
    btn.classList.add("selected");
    state.goal = btn.dataset.goal;
    updateStep2Visibility();
    goTo(2);
  });
});

// ============================================
// STEP 2: ABOUT YOU
// ============================================
(function buildAgePills() {
  var wrap = $("qzAges");
  AGE_BANDS.forEach(function (band) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "qz-pill";
    b.textContent = band;
    b.addEventListener("click", function () {
      wrap.querySelectorAll(".qz-pill").forEach(function (p) { p.classList.remove("selected"); });
      b.classList.add("selected");
      state.ageRange = band;
      validateStep2();
    });
    wrap.appendChild(b);
  });
})();

$("qzGender").querySelectorAll(".qz-pill").forEach(function (btn) {
  btn.addEventListener("click", function () {
    $("qzGender").querySelectorAll(".qz-pill").forEach(function (p) { p.classList.remove("selected"); });
    btn.classList.add("selected");
    state.gender = btn.dataset.gender;
    validateStep2();
  });
});

$("qzTobacco").querySelectorAll(".qz-pill").forEach(function (btn) {
  btn.addEventListener("click", function () {
    $("qzTobacco").querySelectorAll(".qz-pill").forEach(function (p) { p.classList.remove("selected"); });
    btn.classList.add("selected");
    state.tobacco = btn.dataset.tobacco;
    validateStep2();
  });
});

function updateStep2Visibility() {
  // Annuities aren't priced on health — skip the tobacco question.
  // Gender is always asked: it prices final expense and IUL, and the
  // user can still switch products at the match step.
  var needTobacco = state.goal !== "annuity";
  $("qzTobaccoWrap").style.display = needTobacco ? "" : "none";
  validateStep2();
}

function validateStep2() {
  var needTobacco = state.goal !== "annuity";
  var ok = !!state.ageRange && !!state.gender && (!needTobacco || !!state.tobacco);
  $("qzToStep3").disabled = !ok;
}

$("qzToStep3").addEventListener("click", function () { goTo(3); });

// ============================================
// STEP 3: MATCH + COMPARE
// ============================================
function recommend() {
  var idx = ageIdx();
  var goal = state.goal;
  var note = null;
  var product = goal;

  if (goal === "not-sure") {
    if (idx >= 3) { // 50+
      product = "final-expense";
      note = "At your age, most of our clients start with final expense coverage — it's the most affordable way to make sure your family is never stuck with your final costs.";
    } else {
      product = "term-life";
      note = "For most people your age, term life gives the most protection per dollar — it's the foundation nearly everyone should have first.";
    }
  } else if (goal === "final-expense" && !isEligible("final-expense", idx)) {
    product = "term-life";
    note = "Final expense plans start at age 40. At your age, term life actually gets you far more coverage for less money — and it covers final costs too.";
  } else if (goal === "term-life" && !isEligible("term-life", idx)) {
    product = "final-expense";
    note = "Term life is available up to age 75. Based on your age, final expense whole life is the better fit — no medical exam, and the rate never increases.";
  } else if (goal === "iul" && !isEligible("iul", idx)) {
    product = idx >= 3 ? "final-expense" : "term-life";
    note = "IUL is available up to age 70, and works best with time for the cash value to grow. Based on your age, here's the product we'd recommend instead.";
    if (idx >= 5) {
      product = "annuity";
      note = "IUL is available up to age 70 and works best started earlier. For safe, guaranteed growth at your age, a fixed annuity is usually the smarter move.";
    }
  }

  state.product = product;
  state.matchNote = note;
}

function renderMatch() {
  recommend();
  var p = PRODUCTS[state.product];
  var html =
    '<div class="qz-match-card">' +
    '<span class="qz-match-badge">Your Best Fit</span>' +
    "<h3>" + p.name + "</h3>" +
    '<p style="font-size:0.82rem;color:var(--gold-dark);font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:0.75rem;">' + p.subtitle + "</p>" +
    "<p>" + p.blurb + "</p>" +
    '<ul class="qz-match-features">' + p.features.map(function (f) { return "<li>" + f + "</li>"; }).join("") + "</ul>" +
    "</div>";
  if (state.matchNote) {
    html += '<div class="qz-note">' + state.matchNote + "</div>";
  }
  $("qzMatchCard").innerHTML = html;
  renderCompare();
}

function renderCompare() {
  var idx = ageIdx();
  var wrap = $("qzCompare");
  wrap.innerHTML = "";
  Object.keys(PRODUCTS).forEach(function (key) {
    if (key === state.product) return;
    var p = PRODUCTS[key];
    var eligible = isEligible(key, idx);
    var item = document.createElement("div");
    item.className = "qz-compare-item" + (eligible ? "" : " ineligible");
    item.innerHTML =
      "<div><strong>" + p.name + "</strong><span>" + p.blurb + "</span>" +
      (eligible ? "" : '<span style="color:var(--gold-dark);font-weight:700;">' + p.eligibilityLabel + " — not available for your age range</span>") +
      "</div>";
    if (eligible) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Choose This";
      btn.addEventListener("click", function () {
        state.product = key;
        state.matchNote = null;
        renderMatch();
        $("qzCompare").classList.add("open");
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      item.appendChild(btn);
    }
    wrap.appendChild(item);
  });
}

$("qzCompareToggle").addEventListener("click", function () {
  var open = $("qzCompare").classList.toggle("open");
  this.textContent = open ? "Hide other options −" : "Compare the other options +";
});

$("qzToStep4").addEventListener("click", function () { goTo(4); });

// ============================================
// STEP 4: COVERAGE + ESTIMATE
// ============================================
function availableTerms() {
  var band = state.ageRange;
  return ["15", "20", "25", "30"].filter(function (t) { return !!TERM_RATES[t][band]; });
}

function renderCoverage() {
  var p = PRODUCTS[state.product];
  $("qzCoverageTitle").textContent = p.coverageTitle;
  $("qzCoverageSub").textContent = p.coverageSub;

  // Reset selections when arriving (product may have changed)
  state.coverage = p.coverageDefault;
  state.termLength = null;
  $("qzEstimate").style.display = "none";
  $("qzEstimateNote").style.display = "none";
  $("qzToStep5").disabled = true;

  var controls = $("qzCoverageControls");
  controls.innerHTML = "";

  var covLabel = document.createElement("label");
  covLabel.className = "qz-question-label";
  covLabel.textContent = state.product === "annuity" ? "Amount to deposit" : "Coverage amount";
  controls.appendChild(covLabel);

  var wrap = document.createElement("div");
  wrap.className = "qz-slider-wrap";

  var readout = document.createElement("div");
  readout.className = "qz-slider-value";
  readout.textContent = fmtMoney(p.coverageDefault);
  wrap.appendChild(readout);

  var slider = document.createElement("input");
  slider.type = "range";
  slider.className = "qz-slider";
  slider.min = p.coverageMin;
  slider.max = p.coverageMax;
  slider.step = p.coverageStep;
  slider.value = p.coverageDefault;
  slider.setAttribute("aria-label", covLabel.textContent);

  function paintTrack() {
    var pct = ((slider.value - p.coverageMin) / (p.coverageMax - p.coverageMin)) * 100;
    slider.style.background = "linear-gradient(to right, var(--gold) 0%, var(--gold) " + pct + "%, #e2e8f0 " + pct + "%, #e2e8f0 100%)";
  }
  slider.addEventListener("input", function () {
    state.coverage = Number(slider.value);
    readout.textContent = fmtMoney(state.coverage);
    paintTrack();
    updateEstimate();
  });
  paintTrack();
  wrap.appendChild(slider);

  var bounds = document.createElement("div");
  bounds.className = "qz-slider-bounds";
  bounds.innerHTML = "<span>" + fmtMoney(p.coverageMin) + "</span><span>" + fmtMoney(p.coverageMax) + "</span>";
  wrap.appendChild(bounds);

  controls.appendChild(wrap);
  // Slider always has a value — show the estimate right away
  // (term life waits for a term length below).
  updateEstimate();

  if (state.product === "term-life") {
    var termLabel = document.createElement("label");
    termLabel.className = "qz-question-label";
    termLabel.textContent = "Term length";
    controls.appendChild(termLabel);

    var terms = availableTerms();
    var termPills = document.createElement("div");
    termPills.className = "qz-pills";
    terms.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "qz-pill";
      b.textContent = t + " years";
      b.addEventListener("click", function () {
        termPills.querySelectorAll(".qz-pill").forEach(function (x) { x.classList.remove("selected"); });
        b.classList.add("selected");
        state.termLength = t;
        updateEstimate();
      });
      termPills.appendChild(b);
    });
    controls.appendChild(termPills);

    var hidden = ["15", "20", "25", "30"].length - terms.length;
    if (hidden > 0) {
      var note = document.createElement("p");
      note.style.cssText = "font-size:0.8rem;color:var(--slate);margin-top:0.5rem;";
      note.textContent = "Longer terms aren't available for your age range — the options shown are what carriers will issue.";
      controls.appendChild(note);
    }
  }
}

function updateEstimate() {
  var ready = state.coverage && (state.product !== "term-life" || state.termLength);
  if (!ready) return;

  var band = state.ageRange;
  var gender = state.gender === "male" ? "male" : "female";
  var tobacco = state.tobacco === "yes";
  var faceK = state.coverage / 1000;
  var noteEl = $("qzEstimateNote");
  noteEl.style.display = "none";
  var lowM, highM;

  if (state.product === "annuity") {
    var value = Math.round(state.coverage * Math.pow(1 + ANNUITY_RATE, ANNUITY_YEARS));
    state.estimateLow = value;
    state.estimateHigh = value;
    state.estimateLabel = fmtMoney(state.coverage) + " deposit → " + fmtMoney(value) + " guaranteed in 5 yrs";
    $("qzEstimateLabel").textContent = "Guaranteed value in 5 years, tax-deferred";
    $("qzEstimateValue").textContent = fmtMoney(value);
    $("qzEstimateUnit").textContent = "at today's " + (ANNUITY_RATE * 100).toFixed(2) + "% guaranteed rate (as of " + ANNUITY_RATE_ASOF + ")";
  } else if (state.product === "term-life") {
    var rates = TERM_RATES[state.termLength][band];
    if (!rates) return;
    var lowRate = tobacco ? rates[2] : rates[0];
    var highRate = tobacco ? rates[3] : rates[1];
    lowM = Math.round((faceK * lowRate + TERM_POLICY_FEE) * TERM_MODAL_MONTHLY);
    highM = Math.round((faceK * highRate + TERM_POLICY_FEE) * TERM_MODAL_MONTHLY);
  } else if (state.product === "final-expense") {
    var feRates = FE_RATES[gender][band];
    if (!feRates) return;
    // Quit Smoking Advantage: smokers pay non-nicotine rates for
    // policy years 1-3, so the starting premium IS the non-nic rate.
    lowM = Math.round(faceK * feRates[0] + FE_MONTHLY_FEE);
    highM = Math.round(faceK * feRates[1] + FE_MONTHLY_FEE);
    if (tobacco) {
      noteEl.textContent = "Good news for smokers: with Americo's Quit Smoking Advantage, you start at non-tobacco rates for your first 3 years. Your agent will explain how to keep them.";
      noteEl.style.display = "";
    }
  } else { // iul
    var iulRates = IUL_RATES[gender][band];
    if (!iulRates) return;
    var f = tobacco ? IUL_TOBACCO_FACTOR : 1;
    lowM = Math.round(faceK * iulRates[0] * f + IUL_MONTHLY_FEE);
    highM = Math.round(faceK * iulRates[1] * f + IUL_MONTHLY_FEE);
  }

  if (state.product !== "annuity") {
    state.estimateLow = lowM;
    state.estimateHigh = highM;
    state.estimateLabel = lowM === highM ? "$" + lowM + "/mo" : "$" + lowM + "–$" + highM + "/mo";
    $("qzEstimateLabel").textContent = "Your estimated monthly rate";
    $("qzEstimateValue").textContent = lowM === highM ? "$" + lowM : "$" + lowM + " – $" + highM;
    $("qzEstimateUnit").textContent = "per month — exact rate depends on your age and underwriting";
  }

  $("qzEstimate").style.display = "";
  $("qzToStep5").disabled = false;
}

$("qzToStep5").addEventListener("click", function () { goTo(5); });

// ============================================
// STEP 5: SUMMARY + SUBMIT
// ============================================
function renderSummary() {
  var p = PRODUCTS[state.product];
  var parts = ["<strong>" + p.name + "</strong>"];
  if (state.product === "annuity") {
    parts.push(fmtMoney(state.coverage) + " deposit");
  } else {
    parts.push(fmtMoney(state.coverage) + " coverage");
    if (state.termLength) parts.push(state.termLength + "-year term");
  }
  parts.push('<span class="qz-summary-est">' + state.estimateLabel + "</span>");
  $("qzSummary").innerHTML = parts.join(" &bull; ");
}

// UTM & gclid capture (same behavior as form.js)
(function () {
  var params = new URLSearchParams(window.location.search);
  ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid"].forEach(function (key) {
    var value = params.get(key) || "";
    if (value) sessionStorage.setItem(key, value);
    var stored = value || sessionStorage.getItem(key) || "";
    document.querySelectorAll('input[name="' + key + '"]').forEach(function (el) { el.value = stored; });
  });
})();

// Turnstile widget (same pattern as form.js; inactive until key is set)
(function () {
  if (!TURNSTILE_ENABLED) return;
  var form = $("quoteWizardForm");
  var btn = form.querySelector('button[type="submit"]');
  var widget = document.createElement("div");
  widget.className = "cf-turnstile";
  widget.setAttribute("data-sitekey", TURNSTILE_SITE_KEY);
  widget.setAttribute("data-theme", "light");
  widget.style.margin = "16px 0";
  widget.style.display = "flex";
  widget.style.justifyContent = "center";
  btn.parentNode.insertBefore(widget, btn);
  var script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
})();

// Time-trap: stamp first interaction anywhere in the wizard, since the
// user "starts the form" at step 1, long before the contact fields.
(function () {
  var startedAtField = document.querySelector('#quoteWizardForm input[name="formStartedAt"]');
  var marked = false;
  function markStart() {
    if (marked) return;
    marked = true;
    startedAtField.value = String(Date.now());
  }
  document.querySelectorAll(".qz-option, .qz-pill").forEach(function (el) {
    el.addEventListener("click", markStart);
  });
  document.querySelectorAll("#quoteWizardForm input, #quoteWizardForm select").forEach(function (el) {
    el.addEventListener("focus", markStart);
    el.addEventListener("input", markStart);
  });
})();

var MIN_FORM_FILL_MS = 2000;
var formSubmitting = false;

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

$("quoteWizardForm").addEventListener("submit", function (e) {
  e.preventDefault();
  if (formSubmitting) return;
  formSubmitting = true;

  var form = e.target;
  var btn = form.querySelector('button[type="submit"]');
  var data = new FormData(form);
  var originalText = btn.textContent;

  var existingError = form.querySelector(".form-error");
  if (existingError) existingError.remove();
  btn.disabled = true;
  btn.textContent = "Sending...";

  if (TURNSTILE_ENABLED && !data.get("cf-turnstile-response")) {
    showFormError(form, btn, originalText, "Please complete the security check above.");
    return;
  }

  var startedAt = Number(data.get("formStartedAt")) || 0;
  var elapsedMs = startedAt ? Date.now() - startedAt : 0;
  var remainingDelay = Math.max(0, MIN_FORM_FILL_MS - elapsedMs);

  setTimeout(function () {
    submitQuoteLead(form, btn, originalText, data, startedAt);
  }, remainingDelay);
});

function submitQuoteLead(form, btn, originalText, data, startedAt) {
  var formElapsedMs = startedAt ? Date.now() - startedAt : 0;
  var conversionValue = parseFloat(state.coverage) || 1.0;
  var contentName = PRODUCTS[state.product].name + " Quote (Pick Your Policy)";

  fetch("/.netlify/functions/lead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: data.get("name"),
      email: data.get("email"),
      phone: data.get("phone"),
      ageRange: state.ageRange,
      coverageAmount: state.coverage,
      productInterest: state.product,
      timeline: data.get("timeline"),
      utm_source: data.get("utm_source"),
      utm_medium: data.get("utm_medium"),
      utm_campaign: data.get("utm_campaign"),
      utm_content: data.get("utm_content"),
      utm_term: data.get("utm_term"),
      gclid: data.get("gclid"),
      // Pick Your Policy context — shown to the claiming agent
      quote: {
        goal: state.goal,
        gender: state.gender,
        tobacco: state.tobacco,
        termLength: state.termLength,
        estimateLow: state.estimateLow,
        estimateHigh: state.estimateHigh,
        estimateLabel: state.estimateLabel,
      },
      // Bot protection signals
      botField: data.get("bot-field") || "",
      formElapsedMs: formElapsedMs,
      turnstileToken: data.get("cf-turnstile-response") || "",
    }),
  })
    .then(function (res) {
      if (!res.ok) throw new Error("Server returned " + res.status);

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
          event_label: "pick_your_policy_lead",
          event_value: conversionValue,
        });
      }
      if (typeof fbq !== "undefined") {
        fbq("track", "Lead", { content_name: contentName, value: conversionValue, currency: "USD" });
      }
      if (typeof ttq !== "undefined") {
        ttq.track("SubmitForm", { content_name: contentName });
      }

      // Give pixel beacons time to fire before navigating away
      setTimeout(function () {
        window.location.href = "/thank-you.html";
      }, 750);
    })
    .catch(function (err) {
      console.error("Quote submission error:", err);
      if (TURNSTILE_ENABLED && typeof window.turnstile !== "undefined") {
        try { window.turnstile.reset(); } catch (e2) {}
      }
      showFormError(form, btn, originalText, "Something went wrong. Please try again or call us at (312) 203-8106.");
    });
}

// Start at step 1
showStep(1);
