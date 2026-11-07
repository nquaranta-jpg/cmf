// Insights & News: renders the Google Sheet feed (/.netlify/functions/insights,
// falling back to /data/insights.json) on /insights (all items, with
// type filters) and on the homepage (latest few). Static cards already in the
// page stay as the fallback if the fetch fails.
(function () {
  var full = document.getElementById("insightsGrid");
  var desk = document.getElementById("deskGrid");
  if (!full && !desk) return;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDate(d) {
    if (!d) return "";
    var p = d.split("-");
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return months[Number(p[1]) - 1] + " " + Number(p[2]) + ", " + p[0];
  }
  var CTA = { Guide: "Read the guide", Tool: "Open the tool", Workshop: "See the workshop", News: "Read more", Insight: "Read" };

  function card(it, cls) {
    var external = /^https?:/.test(it.url);
    var date = fmtDate(it.date);
    return (
      '<a class="' + cls + '" href="' + esc(it.url) + '"' +
      (external ? ' target="_blank" rel="noopener noreferrer"' : "") +
      ' data-type="' + esc(it.type) + '">' +
      '<span class="ins-meta"><span class="ins-tag">' + esc(it.type) +
      (it.category ? " &middot; " + esc(it.category) : "") + "</span>" +
      (date ? '<span class="ins-date">' + esc(date) + "</span>" : "") + "</span>" +
      "<h3>" + esc(it.title) + "</h3>" +
      "<p>" + esc(it.summary) + "</p>" +
      '<span class="ins-cta">' + esc(CTA[it.type] || "Read") + " &rarr;</span>" +
      "</a>"
    );
  }

  function getJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }
  // Live feed from the Google Sheet; static snapshot if the sheet is unreachable
  getJSON("/.netlify/functions/insights")
    .catch(function () { return getJSON("/data/insights.json"); })
    .then(function (data) {
      var items = (data.items || []).filter(function (it) {
        return it && it.title && it.url;
      });

      if (desk) {
        var n = Number(desk.getAttribute("data-count")) || 4;
        // data-exclude: comma-separated types already shown elsewhere on the page
        var skip = (desk.getAttribute("data-exclude") || "").split(",").map(function (x) { return x.trim(); });
        var latest = items.filter(function (it) { return skip.indexOf(it.type) < 0; });
        desk.innerHTML = latest.slice(0, n).map(function (it) {
          return card(it, "desk-card ins-card");
        }).join("");
      }

      if (full) {
        var featured = items.filter(function (it) { return it.featured; })[0];
        var rest = items.filter(function (it) { return it !== featured; });
        var featEl = document.getElementById("insightsFeatured");
        if (featEl && featured) featEl.innerHTML = card(featured, "ins-card ins-featured");
        function render(type) {
          var list = type === "All" ? rest : items.filter(function (it) { return it.type === type; });
          if (featEl) featEl.style.display = type === "All" && featured ? "" : "none";
          full.innerHTML = list.length
            ? list.map(function (it) { return card(it, "ins-card"); }).join("")
            : '<p class="empty-note">Nothing here yet. Check back soon.</p>';
        }
        var tabs = document.querySelectorAll("[data-ins-filter]");
        var present = {};
        items.forEach(function (it) { present[it.type] = true; });
        tabs.forEach(function (t) {
          var type = t.getAttribute("data-ins-filter");
          if (type !== "All" && !present[type]) t.style.display = "none";
          t.addEventListener("click", function () {
            tabs.forEach(function (x) { x.setAttribute("aria-pressed", x === t ? "true" : "false"); });
            render(type);
          });
        });
        render("All");
      }
    })
    .catch(function () {
      if (full) full.innerHTML = '<p class="empty-note">Insights could not load. Please refresh the page.</p>';
    });
})();
