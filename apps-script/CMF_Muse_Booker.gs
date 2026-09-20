/**
 * CMF Muse Booker
 * Google Apps Script web app that books 20-minute Google Meet consultations
 * for the CMF MCP connector (book_consultation tool).
 *
 * SETUP (one time, in the CMF Workspace account nquaranta@crownmerchantfinancial.com)
 *  1. script.google.com > New project > paste this file. Name it "CMF Muse Booker".
 *  2. Services (+) > add "Google Calendar API" (Advanced Calendar service, identifier
 *     "Calendar"). Needed for the Meet link via conferenceData.
 *  3. Project Settings > Script Properties > add:
 *       BOOKER_SECRET   same 32+ char random string you put in Netlify env BOOKER_SECRET
 *       LEADS_SHEET_ID  (optional) id of the "CMF_Muse_Leads" spreadsheet. If empty,
 *                       the script creates the sheet on first run and stores the id.
 *  4. Run testBlocked() then testBooked() from the editor. Approve the auth prompts.
 *     testBooked() creates a real event on your calendar and emails you; delete it after.
 *  5. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 *     Copy the /exec URL into Netlify env BOOKER_URL.
 *  6. Any code change needs Deploy > Manage deployments > edit > New version.
 *
 * Only doPost is exposed. The shared secret is the gate; compare is constant time.
 */

// ---- Booking rules (edit here) --------------------------------------------
var TIME_ZONE = "America/Chicago";
var CALENDAR_ID = "nquaranta@crownmerchantfinancial.com"; // the calendar that gets the event
var BOOKABLE_DAYS = [1, 2, 3, 4, 5];   // Monday=1 ... Friday=5
var DAY_START_HOUR = 9;               // 9:00 Central
var DAY_END_HOUR = 17;                // last slot must END by 17:00
var SLOT_MINUTES = 20;                // slots on :00, :20, :40
var MIN_LEAD_HOURS = 2;               // at least this far from now
var MAX_DAYS_OUT = 14;                // at most this many days ahead
var ALTERNATIVES_TO_RETURN = 3;
var LEAD_ALERT_TO = "nquaranta@crownmerchantfinancial.com";
var LEADS_SHEET_NAME = "CMF_Muse_Leads";
var LEADS_TAB = "Leads";
var SOURCE_LABEL = "muse";

// ---- Compliance copy (must match src/mcp/config/copy.ts) ------------------
var DISCLAIMER = "This is an estimate, not an offer of coverage. Your actual premium depends on underwriting and approval by the insurance company, and may be higher or lower. Crown Merchant Financial LLC is a licensed independent life insurance agency based in Illinois. License information available on request.";
var CONSENT_VERSION_DEFAULT = "CONSENT_V1";
var WHAT_TO_EXPECT = "On the call a licensed agent will review your goals, confirm the details behind your estimate, and answer questions. There is no obligation.";

var LEAD_HEADERS = [
  "Timestamp", "FirstName", "LastName", "Email", "Phone", "State", "Product", "CoverageAmount",
  "QuoteLow", "QuoteHigh", "Budget", "DecisionMaker", "MeetingStart", "ConsentTimestamp",
  "ConsentTextVersion", "Source", "Result",
];

// ---- Web app entry ---------------------------------------------------------
function doPost(e) {
  try {
    var body = parseBody_(e);
    var expected = PropertiesService.getScriptProperties().getProperty("BOOKER_SECRET") || "";
    if (!expected || !constantTimeEquals_(String(body.secret || ""), expected)) {
      return json_({ status: "error", message: "Unauthorized." });
    }
    delete body.secret;
    var result = bookConsultation_(body);
    return json_(result);
  } catch (err) {
    return json_({ status: "error", message: "Booking failed: " + (err && err.message ? err.message : String(err)) });
  }
}

function doGet() {
  return json_({ status: "error", message: "POST only." });
}

// ---- Core ------------------------------------------------------------------
function bookConsultation_(lead) {
  var first = clean_(lead.first_name, 60);
  var last = clean_(lead.last_name, 60);
  var email = clean_(lead.email, 254).toLowerCase();
  var phone = clean_(lead.phone, 20);
  var state = clean_(lead.state, 2).toUpperCase();
  var preferred = clean_(lead.preferred_start, 40);

  if (!first || !last) return { status: "error", message: "First and last name are required." };
  if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email)) return { status: "error", message: "A valid email is required." };
  if (!/^\+1\d{10}$/.test(phone)) return { status: "error", message: "Phone must be E.164, for example +13125550142." };
  if (lead.consent_to_contact !== true) return { status: "error", message: "The user must agree to the consent text before booking." };

  var start = new Date(preferred);
  if (isNaN(start.getTime())) return { status: "error", message: "preferred_start must be an ISO 8601 date-time with offset." };

  var now = new Date();
  var windowCheck = checkWindow_(start, now);
  if (!windowCheck.ok) {
    return { status: "invalid_time", message: windowCheck.message, alternatives: nearestOpenSlots_(start, now, ALTERNATIVES_TO_RETURN) };
  }

  var existing = findFutureBookingForEmail_(email, now);
  if (existing) {
    return {
      status: "already_booked",
      message: "There is already an upcoming consultation booked for this email on " + formatCentral_(existing.getStartTime()) + ".",
      start: iso_(existing.getStartTime()),
    };
  }

  var end = new Date(start.getTime() + SLOT_MINUTES * 60000);
  if (!isFree_(start, end)) {
    return {
      status: "slot_unavailable",
      message: "That time is not available. Here are the nearest open times.",
      alternatives: nearestOpenSlots_(start, now, ALTERNATIVES_TO_RETURN),
    };
  }

  var qc = lead.quote_context || {};
  var product = clean_(lead.product_interest || qc.product_type || "", 30);
  var coverage = numOrBlank_(qc.coverage_amount);
  var quoteLow = numOrBlank_(qc.monthly_low);
  var quoteHigh = numOrBlank_(qc.monthly_high);
  var budget = numOrBlank_(lead.monthly_budget);
  var decision = lead.is_decision_maker === true ? "Yes" : lead.is_decision_maker === false ? "No" : "";
  var consentTs = clean_(lead.consent_timestamp, 40) || now.toISOString();
  var consentVersion = clean_(lead.consent_version, 20) || CONSENT_VERSION_DEFAULT;

  var description = [
    "Phone: " + phone,
    "",
    "Source: Muse connector",
    "Product interest: " + (product || "not stated"),
    "Coverage amount: " + (coverage === "" ? "not stated" : "$" + Number(coverage).toLocaleString("en-US")),
    "Quote range: " + (quoteLow === "" && quoteHigh === "" ? "none" : "$" + quoteLow + " to $" + quoteHigh + " per month"),
    "Monthly budget: " + (budget === "" ? "not stated" : "$" + budget),
    "Decision maker: " + (decision || "not stated"),
    "State: " + state,
    "Consent: " + consentVersion + " at " + consentTs,
  ].join("\n");

  var event = createMeetEvent_(first, last, email, start, end, description);
  var meetLink = event.hangoutLink || extractMeetLink_(event) || "";

  sendConfirmation_(email, first, start, end, meetLink);
  appendLeadRow_([
    now, first, last, email, phone, state, product, coverage, quoteLow, quoteHigh, budget, decision,
    iso_(start), consentTs, consentVersion, SOURCE_LABEL, "",
  ]);
  sendLeadAlert_({
    first: first, last: last, email: email, phone: phone, state: state, product: product, coverage: coverage,
    quoteLow: quoteLow, quoteHigh: quoteHigh, budget: budget, decision: decision, start: start, meetLink: meetLink,
  });

  return {
    status: "booked",
    start: iso_(start),
    end: iso_(end),
    meet_link: meetLink,
    confirmation_sent_to: email,
  };
}

// ---- Window + availability -------------------------------------------------
function checkWindow_(start, now) {
  var minStart = new Date(now.getTime() + MIN_LEAD_HOURS * 3600000);
  var maxStart = new Date(now.getTime() + MAX_DAYS_OUT * 86400000);
  if (start < minStart) return { ok: false, message: "Consultations must be booked at least " + MIN_LEAD_HOURS + " hours in advance." };
  if (start > maxStart) return { ok: false, message: "Consultations can be booked up to " + MAX_DAYS_OUT + " days out." };
  if (!isOnSlotGrid_(start)) return { ok: false, message: "Consultations start on the hour, at :20, or at :40, Central time." };
  if (!isBusinessHours_(start)) return { ok: false, message: "Consultations are available Monday to Friday, " + DAY_START_HOUR + ":00 to " + DAY_END_HOUR + ":00 Central." };
  return { ok: true };
}

function isOnSlotGrid_(d) {
  var minute = Number(Utilities.formatDate(d, TIME_ZONE, "m"));
  var second = Number(Utilities.formatDate(d, TIME_ZONE, "s"));
  return second === 0 && minute % SLOT_MINUTES === 0;
}

function isBusinessHours_(d) {
  var dow = Number(Utilities.formatDate(d, TIME_ZONE, "u")); // 1=Mon ... 7=Sun
  if (BOOKABLE_DAYS.indexOf(dow) === -1) return false;
  var hour = Number(Utilities.formatDate(d, TIME_ZONE, "H"));
  var minute = Number(Utilities.formatDate(d, TIME_ZONE, "m"));
  var startMin = hour * 60 + minute;
  return startMin >= DAY_START_HOUR * 60 && startMin + SLOT_MINUTES <= DAY_END_HOUR * 60;
}

function isFree_(start, end) {
  var cal = CalendarApp.getCalendarById(CALENDAR_ID);
  var events = cal.getEvents(start, end);
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev.isAllDayEvent()) continue;
    if (ev.getMyStatus && ev.getMyStatus() === CalendarApp.GuestStatus.NO) continue;
    return false;
  }
  return true;
}

/** Walk forward from the requested time (or the earliest allowed time) in slot steps. */
function nearestOpenSlots_(requested, now, count) {
  var out = [];
  var earliest = new Date(now.getTime() + MIN_LEAD_HOURS * 3600000);
  var cursor = new Date(Math.max(requested.getTime(), earliest.getTime()));
  cursor.setSeconds(0, 0);
  // Round up to the slot grid in Central time.
  var minute = Number(Utilities.formatDate(cursor, TIME_ZONE, "m"));
  var bump = (SLOT_MINUTES - (minute % SLOT_MINUTES)) % SLOT_MINUTES;
  if (bump) cursor = new Date(cursor.getTime() + bump * 60000);
  var limit = new Date(now.getTime() + MAX_DAYS_OUT * 86400000);
  var guard = 0;
  while (out.length < count && cursor <= limit && guard++ < 2000) {
    if (isBusinessHours_(cursor)) {
      var end = new Date(cursor.getTime() + SLOT_MINUTES * 60000);
      if (isFree_(cursor, end)) out.push(iso_(cursor));
    }
    cursor = new Date(cursor.getTime() + SLOT_MINUTES * 60000);
  }
  return out;
}

function findFutureBookingForEmail_(email, now) {
  var cal = CalendarApp.getCalendarById(CALENDAR_ID);
  var horizon = new Date(now.getTime() + (MAX_DAYS_OUT + 1) * 86400000);
  var events = cal.getEvents(now, horizon, { search: "CMF Consultation" });
  for (var i = 0; i < events.length; i++) {
    var guests = events[i].getGuestList();
    for (var g = 0; g < guests.length; g++) {
      if (String(guests[g].getEmail()).toLowerCase() === email) return events[i];
    }
  }
  return null;
}

// ---- Calendar event with Meet link (Advanced Calendar service) ------------
function createMeetEvent_(first, last, email, start, end, description) {
  var resource = {
    summary: "CMF Consultation: " + first + " " + last + " (Muse)",
    description: description,
    start: { dateTime: iso_(start), timeZone: TIME_ZONE },
    end: { dateTime: iso_(end), timeZone: TIME_ZONE },
    attendees: [{ email: email }],
    conferenceData: {
      createRequest: {
        requestId: Utilities.getUuid(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
    reminders: { useDefault: true },
    guestsCanModify: false,
  };
  // sendUpdates "none": we send our own confirmation email below. Switch to "all"
  // if you would rather rely on the Google Calendar invitation email.
  return Calendar.Events.insert(resource, CALENDAR_ID, { conferenceDataVersion: 1, sendUpdates: "none" });
}

function extractMeetLink_(event) {
  try {
    var eps = event.conferenceData && event.conferenceData.entryPoints;
    for (var i = 0; eps && i < eps.length; i++) {
      if (eps[i].entryPointType === "video") return eps[i].uri;
    }
  } catch (e) {}
  return "";
}

// ---- Email -----------------------------------------------------------------
function sendConfirmation_(email, first, start, end, meetLink) {
  var when = formatCentral_(start) + " to " + Utilities.formatDate(end, TIME_ZONE, "h:mm a") + " Central";
  var lines = [
    "Hi " + first + ",",
    "",
    "Your free 20-minute consultation with Crown Merchant Financial is confirmed.",
    "",
    "When: " + when,
    "Where: Google Meet, " + (meetLink || "link will be in your calendar invite"),
    "",
    WHAT_TO_EXPECT,
    "",
    "Need to change the time? Reply to this email or call (312) 203-8106.",
    "",
    DISCLAIMER,
  ];
  // No manual signature block: the Workspace signature is appended automatically.
  GmailApp.sendEmail(email, "Your CMF Meeting Is Confirmed", lines.join("\n"), { name: "Crown Merchant Financial" });
}

function sendLeadAlert_(d) {
  var lines = [
    "New Muse consultation booked.",
    "",
    "Name: " + d.first + " " + d.last,
    "Email: " + d.email,
    "Phone: " + d.phone,
    "State: " + d.state,
    "Product: " + (d.product || "not stated"),
    "Coverage: " + (d.coverage === "" ? "not stated" : "$" + d.coverage),
    "Quote range: " + (d.quoteLow === "" ? "none" : "$" + d.quoteLow + " to $" + d.quoteHigh),
    "Budget: " + (d.budget === "" ? "not stated" : "$" + d.budget),
    "Decision maker: " + (d.decision || "not stated"),
    "Meeting: " + formatCentral_(d.start) + " Central",
    "Meet: " + d.meetLink,
    "",
    "Sheet: " + LEADS_SHEET_NAME + " / " + LEADS_TAB,
  ];
  GmailApp.sendEmail(LEAD_ALERT_TO, "Muse lead booked: " + d.first + " " + d.last + " (" + d.state + ")", lines.join("\n"));
}

// ---- Sheet -----------------------------------------------------------------
function getLeadsSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("LEADS_SHEET_ID");
  var ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create(LEADS_SHEET_NAME);
    props.setProperty("LEADS_SHEET_ID", ss.getId());
  }
  var sheet = ss.getSheetByName(LEADS_TAB);
  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName(LEADS_TAB);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(LEAD_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function appendLeadRow_(row) {
  getLeadsSheet_().appendRow(row);
}

// ---- Helpers ---------------------------------------------------------------
function parseBody_(e) {
  var raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
  var body = JSON.parse(raw);
  if (!body || typeof body !== "object") throw new Error("Body must be a JSON object.");
  return body;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function constantTimeEquals_(a, b) {
  var ab = Utilities.newBlob(a).getBytes();
  var bb = Utilities.newBlob(b).getBytes();
  var diff = ab.length ^ bb.length;
  var n = Math.max(ab.length, bb.length);
  for (var i = 0; i < n; i++) {
    diff |= (ab[i % Math.max(ab.length, 1)] || 0) ^ (bb[i % Math.max(bb.length, 1)] || 0);
  }
  return diff === 0;
}

function clean_(v, max) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, max);
}

function numOrBlank_(v) {
  var n = Number(v);
  return v === null || v === undefined || v === "" || isNaN(n) ? "" : Math.round(n);
}

function iso_(d) {
  // ISO 8601 with the Central offset, e.g. 2026-09-22T14:00:00-05:00
  return Utilities.formatDate(d, TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function formatCentral_(d) {
  return Utilities.formatDate(d, TIME_ZONE, "EEEE, MMMM d, yyyy 'at' h:mm a");
}

// ---- Editor tests (run these before deploying) -----------------------------
/** Next valid slot at least 3 hours out, on a weekday, inside business hours. */
function nextTestSlot_() {
  var now = new Date();
  var slots = nearestOpenSlots_(new Date(now.getTime() + 3 * 3600000), now, 1);
  if (!slots.length) throw new Error("No open slot found in the next " + MAX_DAYS_OUT + " days.");
  return slots[0];
}

/** Creates a REAL event, emails you, appends a sheet row. Delete the event afterward. */
function testBooked() {
  var res = bookConsultation_({
    first_name: "Test",
    last_name: "Booking",
    email: LEAD_ALERT_TO,
    phone: "+13122038106",
    state: "IL",
    preferred_start: nextTestSlot_(),
    consent_to_contact: true,
    product_interest: "term",
    quote_context: { product_type: "term", coverage_amount: 500000, term_years: 20, monthly_low: 30, monthly_high: 45 },
    monthly_budget: 50,
    is_decision_maker: true,
    consent_timestamp: new Date().toISOString(),
    consent_version: CONSENT_VERSION_DEFAULT,
    source: SOURCE_LABEL,
  });
  Logger.log(JSON.stringify(res, null, 2));
  if (res.status !== "booked") throw new Error("Expected booked, got " + res.status + ": " + res.message);
}

/** Exercises every rejection path without touching the calendar. */
function testBlocked() {
  var base = {
    first_name: "Test", last_name: "Blocked", email: LEAD_ALERT_TO, phone: "+13122038106", state: "IL",
    preferred_start: nextTestSlot_(), consent_to_contact: true,
  };
  var cases = [
    ["no consent", Object.assign({}, base, { consent_to_contact: false }), "error"],
    ["bad phone", Object.assign({}, base, { phone: "312-203-8106" }), "error"],
    ["bad email", Object.assign({}, base, { email: "nope" }), "error"],
    ["too soon", Object.assign({}, base, { preferred_start: iso_(new Date(Date.now() + 10 * 60000)) }), "invalid_time"],
    ["too far", Object.assign({}, base, { preferred_start: iso_(new Date(Date.now() + 30 * 86400000)) }), "invalid_time"],
    ["off grid", Object.assign({}, base, { preferred_start: iso_(new Date(new Date(base.preferred_start).getTime() + 5 * 60000)) }), "invalid_time"],
  ];
  var failures = [];
  cases.forEach(function (c) {
    var res = bookConsultation_(c[1]);
    Logger.log(c[0] + " -> " + JSON.stringify(res));
    if (res.status !== c[2]) failures.push(c[0] + ": expected " + c[2] + ", got " + res.status);
  });
  // Wrong secret through doPost
  var unauthorized = JSON.parse(doPost({ postData: { contents: JSON.stringify(Object.assign({ secret: "wrong" }, base)) } }).getContent());
  Logger.log("wrong secret -> " + JSON.stringify(unauthorized));
  if (unauthorized.status !== "error" || unauthorized.message !== "Unauthorized.") failures.push("wrong secret was not rejected");
  if (failures.length) throw new Error(failures.join("; "));
  Logger.log("testBlocked: all rejection paths behaved.");
}
