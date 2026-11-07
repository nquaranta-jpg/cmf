// Rethink thesis panels: accessible tabs that auto-advance until the
// visitor interacts. Respects prefers-reduced-motion (no auto-advance).
(function () {
  var root = document.querySelector("[data-rethink]");
  if (!root) return;

  var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
  var panels = tabs.map(function (t) {
    return document.getElementById(t.getAttribute("aria-controls"));
  });
  var current = 0;
  var timer = null;
  var INTERVAL = 8000;
  var reduce =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function select(i, focus) {
    current = (i + tabs.length) % tabs.length;
    tabs.forEach(function (t, n) {
      var on = n === current;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      panels[n].hidden = !on;
    });
    if (focus) tabs[current].focus();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function start() {
    if (reduce || timer) return;
    timer = setInterval(function () {
      select(current + 1, false);
    }, INTERVAL);
  }

  tabs.forEach(function (t, n) {
    t.addEventListener("click", function () {
      stop();
      select(n, false);
    });
    t.addEventListener("keydown", function (e) {
      var next = null;
      if (e.key === "ArrowRight") next = current + 1;
      else if (e.key === "ArrowLeft") next = current - 1;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabs.length - 1;
      if (next === null) return;
      e.preventDefault();
      stop();
      select(next, true);
    });
  });

  // Deep links like /#rethink-retirement open that panel.
  var hash = window.location.hash.replace("#", "");
  var fromHash = tabs.findIndex(function (t) {
    return t.getAttribute("aria-controls") === hash;
  });

  root.addEventListener("mouseenter", stop);
  root.addEventListener("focusin", stop);

  select(fromHash >= 0 ? fromHash : 0, false);
  if (fromHash < 0) start();
})();
