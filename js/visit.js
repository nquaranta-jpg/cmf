// Tagged-link visitor tracking (first party). See netlify/functions/lib/visits.mjs.
//
// Does nothing unless the visitor arrived through one of our tagged email
// links (?v=<token>). Then it keeps the token in a first-party cookie and
// reports which pages that browser views and for how long, to /api/visit on
// this site. No third party is involved and anonymous visitors are not tracked.
//
// Load it WITHOUT defer as the first script in <head>, before js/tracking.js
// or any other third-party tag, so the token is gone from the address bar
// before an ad pixel can read the URL. It needs no DOM.
//
// Respects Global Privacy Control and the opt-out on /privacy
// (window.cmfVisitOptOut). Email security scanners open links too (and a
// #fragment or restored scroll position can scroll the page on its own), so
// a page view is only reported after a real person taps, clicks, types or
// uses the wheel/trackpad.
(function () {
  "use strict";
  var COOKIE = "cmf_v";
  var OFF = "cmf_v_off";
  var TOKEN_RE = /^[A-Za-z0-9_-]{16}$/;
  var ENDPOINT = "/api/visit";

  function readCookie() {
    var m = document.cookie.match(/(?:^|;\s*)cmf_v=([^;]+)/);
    return m && TOKEN_RE.test(m[1]) ? m[1] : null;
  }
  function writeCookie(v) {
    document.cookie = COOKIE + "=" + v + "; Max-Age=31536000; Path=/; SameSite=Lax" +
      (location.protocol === "https:" ? "; Secure" : "");
  }
  function clearCookie() {
    document.cookie = COOKIE + "=; Max-Age=0; Path=/; SameSite=Lax";
  }
  function optedOut() {
    try { return localStorage.getItem(OFF) === "1"; } catch (e) { return false; }
  }

  window.cmfVisitOptOut = function () {
    clearCookie();
    try { localStorage.setItem(OFF, "1"); } catch (e) {}
    stopped = true;
  };

  var stopped = false;

  // Take the token off the address bar so it isn't bookmarked or shared.
  var fresh = null;
  try {
    var url = new URL(location.href);
    if (url.searchParams.has("v")) {
      fresh = url.searchParams.get("v");
      url.searchParams.delete("v");
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    }
  } catch (e) {}

  if (navigator.globalPrivacyControl === true || optedOut()) {
    clearCookie();
    return;
  }
  if (navigator.webdriver) return;

  if (fresh && TOKEN_RE.test(fresh)) writeCookie(fresh);
  var token = readCookie();
  if (!token) return;

  // Opted out (or the cookie was cleared or replaced) in another tab since
  // this page loaded: go quiet.
  function stillTracking() {
    if (!stopped && (optedOut() || readCookie() !== token)) stopped = true;
    return !stopped;
  }

  // Views go by fetch so the response can re-set the cookie (see
  // netlify/functions/visit.mjs); time-on-page goes by sendBeacon because it
  // is sent while the page is closing.
  function send(payload, beacon) {
    if (!stillTracking()) return;
    payload.t = token;
    payload.p = location.pathname;
    var body = JSON.stringify(payload);
    if (beacon) {
      try {
        if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body)) return;
      } catch (e) {}
    }
    try {
      fetch(ENDPOINT, { method: "POST", body: body, keepalive: true, credentials: "same-origin" }).catch(function () {});
    } catch (e) {}
  }

  function externalReferrer() {
    try {
      if (!document.referrer) return "";
      var r = new URL(document.referrer);
      return r.host === location.host ? "" : r.host;
    } catch (e) { return ""; }
  }

  // Page view, after the first sign of a real person.
  var viewed = false;
  var EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"];
  function onEngage() {
    if (viewed || document.visibilityState !== "visible") return;
    viewed = true;
    EVENTS.forEach(function (ev) { window.removeEventListener(ev, onEngage, true); });
    visibleSince = Date.now();
    send({ type: "view", r: externalReferrer() }, false);
  }
  EVENTS.forEach(function (ev) { window.addEventListener(ev, onEngage, { capture: true, passive: true }); });

  // Time on page: visible time after the view, flushed when the tab is hidden or closed.
  var activeMs = 0;
  var visibleSince = 0;
  function flush() {
    if (!viewed) return;
    if (visibleSince) { activeMs += Date.now() - visibleSince; visibleSince = 0; }
    var secs = Math.round(activeMs / 1000);
    if (secs >= 1) { send({ type: "time", s: secs }, true); activeMs = 0; }
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flush();
    else if (viewed) visibleSince = Date.now();
  });
  window.addEventListener("pagehide", flush);
  // Back/forward cache: a restored page counts as a new view once engaged.
  window.addEventListener("pageshow", function (e) {
    if (!e.persisted || !stillTracking()) return;
    viewed = false;
    activeMs = 0;
    visibleSince = 0;
    EVENTS.forEach(function (ev) { window.addEventListener(ev, onEngage, { capture: true, passive: true }); });
  });
})();
