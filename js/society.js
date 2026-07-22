// ============================================================
// CMF SOCIETY - event rendering + membership form
// Depends on /js/society-events.js (window.SOCIETY_EVENTS).
// ============================================================
(function () {
  "use strict";

  var EVENTS = window.SOCIETY_EVENTS || [];

  // Capture UTM / gclid params so attribution survives navigation,
  // same convention as /js/form.js on the main site.
  (function () {
    var params = new URLSearchParams(window.location.search);
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid"].forEach(function (key) {
      var value = params.get(key);
      if (value) sessionStorage.setItem(key, value);
    });
  })();

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var CAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2.5" x2="8" y2="6.5"/><line x1="16" y1="2.5" x2="16" y2="6.5"/></svg>';
  var PIN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>';

  function eventCard(ev, opts) {
    var isPast = ev.status === "past";
    var label = opts.label || (isPast ? "Past Workshop" : "Upcoming Workshop");
    var html =
      '<article class="event-card' + (isPast ? " past" : "") + '">' +
      '<span class="soc-label">' + esc(label) + "</span>" +
      "<h3>" + esc(ev.title) + "</h3>" +
      '<div class="meta">' +
      "<span>" + CAL_ICON + esc(ev.date) + "</span>" +
      "<span>" + PIN_ICON + esc(ev.venue) + "</span>" +
      "</div>" +
      '<p class="desc">' + esc(ev.description) + "</p>";
    if (!isPast) {
      html +=
        '<div class="event-cta">' +
        '<a class="soc-btn gold" data-event-rsvp="' + esc(ev.id) + '" href="' + esc(opts.rsvpHref(ev)) + '">Reserve Your Seat</a>' +
        "</div>";
    }
    html += "</article>";
    return html;
  }

  // Featured card on /society: the soonest upcoming event
  var featured = document.getElementById("next-workshop");
  if (featured) {
    var next = EVENTS.filter(function (e) { return e.status === "upcoming"; })[0];
    if (next) {
      featured.innerHTML = eventCard(next, {
        label: "Next Workshop",
        rsvpHref: function (ev) { return "#join"; },
      });
    } else {
      featured.innerHTML =
        '<article class="event-card"><span class="soc-label">Workshops</span>' +
        "<h3>The next workshop will be announced soon</h3>" +
        '<p class="desc">Join the Society below and you will be the first to hear the date.</p>' +
        '<div class="event-cta"><a class="soc-btn gold" href="#join">Become a Member</a></div></article>';
    }
  }

  // Full listings on /society/workshops
  var upcomingList = document.getElementById("upcoming-workshops");
  var pastList = document.getElementById("past-workshops");
  if (upcomingList) {
    var upcoming = EVENTS.filter(function (e) { return e.status === "upcoming"; });
    upcomingList.innerHTML = upcoming.length
      ? upcoming.map(function (ev) {
          return eventCard(ev, {
            rsvpHref: function (e) { return "/society/?event=" + encodeURIComponent(e.id) + "#join"; },
          });
        }).join("")
      : '<p class="empty-note">New workshops are being scheduled now. Join the Society and you will be the first to hear.</p>';
  }
  if (pastList) {
    var past = EVENTS.filter(function (e) { return e.status === "past"; });
    pastList.innerHTML = past.length
      ? past.map(function (ev) { return eventCard(ev, { rsvpHref: function () { return "#"; } }); }).join("")
      : '<p class="empty-note">The Society is just getting started. Our first workshops will appear here after they are held.</p>';
  }

  // ---------------- Membership form ----------------
  var form = document.getElementById("societyJoinForm");
  if (!form) return;

  var eventField = form.querySelector('input[name="eventInterest"]');
  var interestField = form.querySelector('select[name="interest"]');

  function findEvent(id) {
    for (var i = 0; i < EVENTS.length; i++) if (EVENTS[i].id === id) return EVENTS[i];
    return null;
  }

  function preselectEvent(id) {
    var ev = findEvent(id);
    if (!ev || !eventField) return;
    eventField.value = ev.title;
    if (interestField) interestField.value = "Workshops";
    var note = document.getElementById("join-event-note");
    if (note) {
      note.textContent = "Reserving a seat for: " + ev.title;
      note.style.display = "block";
    }
  }

  // Preselect from ?event= (links from the workshops page)
  var params = new URLSearchParams(window.location.search);
  if (params.get("event")) preselectEvent(params.get("event"));

  // Preselect from the RSVP button on this page
  document.querySelectorAll("[data-event-rsvp]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      preselectEvent(btn.getAttribute("data-event-rsvp"));
    });
  });

  // Bot protection: stamp first interaction time (matches site convention)
  var startedAtField = form.querySelector('input[name="formStartedAt"]');
  var marked = false;
  function markStart() {
    if (marked) return;
    marked = true;
    if (startedAtField) startedAtField.value = String(Date.now());
  }
  form.querySelectorAll("input, select").forEach(function (field) {
    if (field === startedAtField) return;
    field.addEventListener("focus", markStart);
    field.addEventListener("input", markStart);
  });

  var MIN_FILL_MS = 2000;
  var submitting = false;

  function showError(btn, originalText, message) {
    submitting = false;
    btn.disabled = false;
    btn.textContent = originalText;
    var existing = form.querySelector(".form-error");
    if (existing) existing.remove();
    var div = document.createElement("div");
    div.className = "form-error";
    div.textContent = message;
    form.appendChild(div);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (submitting) return;
    submitting = true;

    var btn = form.querySelector('button[type="submit"]');
    var originalText = btn.textContent;
    var data = new FormData(form);
    var existing = form.querySelector(".form-error");
    if (existing) existing.remove();

    btn.disabled = true;
    btn.textContent = "Submitting...";

    var startedAt = Number(data.get("formStartedAt")) || 0;
    var elapsed = startedAt ? Date.now() - startedAt : 0;
    var delay = Math.max(0, MIN_FILL_MS - elapsed);

    setTimeout(function () {
      fetch("/.netlify/functions/society-join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: data.get("firstName"),
          lastName: data.get("lastName"),
          email: data.get("email"),
          phone: data.get("phone"),
          city: data.get("city"),
          interest: data.get("interest"),
          eventInterest: data.get("eventInterest"),
          consent: !!data.get("consent"),
          botField: data.get("bot-field") || "",
          formElapsedMs: startedAt ? Date.now() - startedAt : 0,
          utm_source: sessionStorage.getItem("utm_source") || "",
          utm_medium: sessionStorage.getItem("utm_medium") || "",
          utm_campaign: sessionStorage.getItem("utm_campaign") || "",
          gclid: sessionStorage.getItem("gclid") || "",
        }),
      })
        .then(function (res) {
          if (!res.ok) throw new Error("Server returned " + res.status);
          // Swap the form for the membership card confirmation
          var card = document.getElementById("member-card");
          var nameEl = document.getElementById("member-card-name");
          var first = (data.get("firstName") || "").toString().trim();
          var last = (data.get("lastName") || "").toString().trim();
          if (nameEl && (first || last)) nameEl.textContent = (first + " " + last).trim();
          form.style.display = "none";
          var intro = document.getElementById("join-intro");
          if (intro) intro.style.display = "none";
          if (card) {
            card.style.display = "block";
            card.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        })
        .catch(function () {
          showError(btn, originalText, "Something went wrong. Please try again, or call us at (312) 203-8106 and we will sign you up over the phone.");
        });
    }, delay);
  });
})();
