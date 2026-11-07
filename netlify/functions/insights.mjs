// Insights & News feed for /insights and the homepage.
// Source of truth: the "CMF Website: Insights & News" Google Sheet (tab
// "Insights"), shared view-only by link. Each row is one item; the Show
// checkbox publishes it. Responses are cached at Netlify's edge for 5 minutes,
// so sheet edits appear on the site within about 5 minutes.
// If the sheet can't be read, this returns 502 and the page falls back to the
// static /data/insights.json snapshot.

const SHEET_ID = process.env.INSIGHTS_SHEET_ID || "1oQ734CY_Grh1pPM08VTEqC0q6J6QCt5wOnBni60PiM0";
const TAB = "Insights";
const TYPES = ["Insight", "Guide", "Tool", "Workshop", "News"];

// Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, newlines in quotes)
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const truthy = (v) => /^(true|yes|y|x|1)$/i.test(String(v || "").trim());

// Accept 2026-11-07, 11/7/2026 or 2026/11/07; return YYYY-MM-DD or ""
export function normDate(v) {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return "";
}

// Only site paths or http(s) links; anything else is dropped
function safeUrl(v) {
  const s = String(v || "").trim();
  if (/^\/(?!\/)/.test(s) || /^https?:\/\//i.test(s)) return s;
  return "";
}

export function rowsToItems(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const idx = {
    show: col("show"), date: col("date"), type: col("type"), category: col("category"),
    title: col("title"), summary: col("summary"), url: col("link"), featured: col("featured"),
  };
  const get = (r, k) => (idx[k] >= 0 ? (r[idx[k]] || "").trim() : "");
  const items = [];
  rows.slice(1).forEach((r, order) => {
    if (!truthy(get(r, "show"))) return;
    const title = get(r, "title");
    const url = safeUrl(get(r, "url"));
    if (!title || !url) return;
    let type = get(r, "type");
    type = TYPES.find((t) => t.toLowerCase() === type.toLowerCase()) || "Insight";
    const item = { type, category: get(r, "category"), title, summary: get(r, "summary"), url, date: normDate(get(r, "date")), order };
    if (truthy(get(r, "featured"))) item.featured = true;
    items.push(item);
  });
  // Newest dated items first; undated (evergreen) items keep sheet order after them
  items.sort((a, b) => {
    if (a.date && b.date) return b.date.localeCompare(a.date) || a.order - b.order;
    if (a.date) return -1;
    if (b.date) return 1;
    return a.order - b.order;
  });
  let featuredSeen = false;
  return items.map(({ order, ...it }) => {
    if (it.featured) {
      if (featuredSeen) delete it.featured;
      featuredSeen = true;
    }
    return it;
  });
}

export default async function handler() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(TAB)}&headers=1`;
  try {
    const res = await fetch(url, { redirect: "follow" });
    const text = await res.text();
    if (!res.ok || /^\s*</.test(text)) throw new Error(`sheet fetch ${res.status}`);
    const items = rowsToItems(parseCSV(text));
    return new Response(JSON.stringify({ items, source: "sheet" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60",
        "Netlify-CDN-Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error("insights feed failed:", err.message);
    return new Response(JSON.stringify({ error: "sheet unavailable" }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}
