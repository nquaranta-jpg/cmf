// ============================================
// TRACKING PIXEL INITIALIZATION
// Google Ads, Bing UET, Meta Pixel, TikTok Pixel
// ============================================

// --- Google Ads (gtag.js) ---
(function () {
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=AW-17990540500";
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", "AW-17990540500", { allow_enhanced_conversions: true });
  gtag("config", "AW-17985807008", { allow_enhanced_conversions: true });
})();

// --- Microsoft / Bing UET Tag ---
(function (w, d, t, r, u) {
  var f, n, i;
  w[u] = w[u] || [];
  f = function () {
    var o = { ti: "343236848", enableAutoSpaTracking: true };
    o.q = w[u];
    w[u] = new UET(o);
    w[u].push("pageLoad");
  };
  n = d.createElement(t);
  n.src = r;
  n.async = 1;
  n.onload = n.onreadystatechange = function () {
    var s = this.readyState;
    if (s && s !== "loaded" && s !== "complete") return;
    f();
    n.onload = n.onreadystatechange = null;
  };
  i = d.getElementsByTagName(t)[0];
  i.parentNode.insertBefore(n, i);
})(window, document, "script", "//bat.bing.com/bat.js", "uetq");

// --- Meta Pixel (Facebook / Instagram) ---
!(function (f, b, e, v, n, t, s) {
  if (f.fbq) return;
  n = f.fbq = function () {
    n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
  };
  if (!f._fbq) f._fbq = n;
  n.push = n;
  n.loaded = !0;
  n.version = "2.0";
  n.queue = [];
  t = b.createElement(e);
  t.async = !0;
  t.src = v;
  s = b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t, s);
})(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
fbq("init", "1263380418574595");
fbq("track", "PageView");

// --- TikTok Pixel ---
!(function (w, d, t) {
  w.TiktokAnalyticsObject = t;
  var ttq = (w[t] = w[t] || []);
  ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie"];
  ttq.setAndDefer = function (t, e) {
    t[e] = function () {
      t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
    };
  };
  for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
  ttq.instance = function (t) {
    for (var e = ttq._i[t] || [], n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]);
    return e;
  };
  ttq.load = function (e, n) {
    var i = "https://analytics.tiktok.com/i18n/pixel/events.js";
    ttq._i = ttq._i || {};
    ttq._i[e] = [];
    ttq._i[e]._u = i;
    ttq._t = ttq._t || {};
    ttq._t[e] = +new Date();
    ttq._o = ttq._o || {};
    ttq._o[e] = n || {};
    var o = document.createElement("script");
    o.type = "text/javascript";
    o.async = !0;
    o.src = i + "?sdkid=" + e + "&lib=" + t;
    var a = document.getElementsByTagName("script")[0];
    a.parentNode.insertBefore(o, a);
  };
  ttq.load("D6JJ8J3C77U3LLVVPRMG");
  ttq.page();
})(window, document, "ttq");

// --- OpenAI / ChatGPT Pixel ---
!(function (w, d, s, u) {
  if (w.oaiq) return;
  var q = function () { q.q.push(arguments); };
  q.q = [];
  w.oaiq = q;
  var j = d.createElement(s);
  j.async = 1;
  j.src = u;
  var f = d.getElementsByTagName(s)[0];
  f.parentNode.insertBefore(j, f);
})(window, document, "script", "https://bzrcdn.openai.com/sdk/oaiq.min.js");
oaiq("init", { pixelId: "XgZ6ph1wRQG9ob3R2hH5Yi", debug: false });

// --- Contact click tracking (tel: / mailto:) ---
// The senior audience converts by tapping the phone number at least as often
// as by submitting a form; without this, ad platforms never see those
// conversions. Delegated listener so it covers every page that loads this
// file, including links added after load.
document.addEventListener("click", function (e) {
  var a = e.target && e.target.closest && e.target.closest('a[href^="tel:"], a[href^="mailto:"]');
  if (!a) return;
  var isPhone = a.getAttribute("href").indexOf("tel:") === 0;
  if (typeof fbq !== "undefined") fbq("track", "Contact");
  if (typeof ttq !== "undefined") ttq.track("Contact");
  if (typeof gtag !== "undefined") {
    gtag("event", isPhone ? "phone_call_click" : "email_click", {
      event_category: "conversion",
      event_label: location.pathname,
    });
  }
  if (typeof window.uetq !== "undefined") {
    window.uetq.push("event", isPhone ? "phone_call_click" : "email_click", {
      event_category: "conversion",
    });
  }
});
