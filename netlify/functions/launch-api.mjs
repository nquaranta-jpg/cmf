// CMF Launch client platform API.
//   POST ?action=login        {email, password}            -> {token, client}
//   GET  ?action=bootstrap    Authorization: Bearer <tok>  -> {client, leads, spend}
//   POST ?action=update-lead  Authorization: Bearer <tok>  {id, status, notes}
//   GET  ?action=export&type=leads|submissions             -> CSV (admin: X-Dashboard-Pin header or ?pin=)
//
// Auth: email/password against launch_clients (scrypt hashes), sessions
// are HMAC-signed tokens — no client-side Supabase SDK, no anon key
// exposure, matching the site's functions-only backend pattern.
//
// DEMO MODE: active unless LAUNCH_DEMO=false. If the demo login
// (demo@cmflaunch.com / LaunchClient2026!) can't be found in the
// database (tables not created yet, or Supabase not configured), the
// API serves a realistic in-memory dataset so the dashboard can be
// reviewed with zero setup. Once launch_schema.sql + launch_seed.sql
// have been run, the same login transparently uses the real database.
// Set LAUNCH_DEMO=false in production to disable the fallback.
import crypto from "node:crypto";
import { getSupabase } from "./lib/supabase.mjs";

const SESSION_SECRET = process.env.LAUNCH_SESSION_SECRET
  || process.env.SUPABASE_SERVICE_KEY
  || "cmf-launch-demo-only-secret"; // only reachable when Supabase isn't configured at all
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEMO_ENABLED = process.env.LAUNCH_DEMO !== "false";
const DEMO_EMAIL = "demo@cmflaunch.com";
const DEMO_PASSWORD = "LaunchClient2026!";
const LEAD_STATUSES = ["new", "contacted", "appointment", "sold", "dead"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Dashboard-Pin",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(statusCode, body, headers) {
  return { statusCode, headers: { ...CORS, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) };
}

// ── Sessions ─────────────────────────────────────────────────
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function signToken(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", SESSION_SECRET).update(body).digest());
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", SESSION_SECRET).update(body).digest());
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
function bearer(event) {
  const h = event.headers["authorization"] || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

// ── Passwords: scrypt$16384$<salt-hex>$<key-hex> ─────────────
function verifyPassword(password, stored) {
  try {
    const [scheme, , salt, keyHex] = String(stored).split("$");
    if (scheme !== "scrypt" || !salt || !keyHex) return false;
    const derived = crypto.scryptSync(password, salt, keyHex.length / 2);
    return crypto.timingSafeEqual(derived, Buffer.from(keyHex, "hex"));
  } catch {
    return false;
  }
}

// ── Demo dataset (in-memory; per function instance) ──────────
const DEMO_CLIENT = {
  id: "demo",
  email: DEMO_EMAIL,
  full_name: "Jordan Demo",
  agency_name: "Demo Insurance Group",
  plan: "ads_managed",
  billing_status: "active",
  monthly_ad_budget: 3000,
};

const DEMO_NAMES = ["Mary Sample", "James Testman", "Patricia Demoson", "Robert Fakely", "Linda Placeholder", "Michael Mockford", "Barbara Example", "William Dummy", "Elizabeth Specimen", "David Sampleton", "Susan Mockwell", "Richard Testerly", "Jessica Demofield", "Thomas Fauxman", "Sarah Exampleton", "Charles Mocksmith", "Karen Sampleworth", "Christopher Testwood", "Nancy Demolane", "Daniel Fakerton", "Lisa Specimenson", "Matthew Mockler", "Betty Samplefield", "Anthony Testbrook", "Margaret Demoford", "Mark Fauxwell", "Sandra Exemplar", "Donald Mockton", "Ashley Samplewood", "Steven Testfield"];
const DEMO_STATES = ["IL", "TX", "FL", "OH", "GA", "NC", "AZ", "MI", "PA", "TN"];
const DEMO_TYPES = ["final_expense", "final_expense", "term_life", "iul", "veteran", "mortgage_protection"];

let demoLeads = null;
function getDemoLeads() {
  if (demoLeads) return demoLeads;
  demoLeads = DEMO_NAMES.map((name, idx) => {
    const i = idx + 1;
    // newest leads (high i = most recent) are still "new"; oldest are worked
    const status = i > 24 ? "new" : i > 16 ? "contacted" : i > 11 ? "appointment" : i > 5 ? "sold" : "dead";
    return {
      id: `demo-lead-${i}`,
      name,
      phone: `(555) 01${String(i).padStart(2, "0")}-${String(1000 + i * 37).padStart(4, "0")}`,
      email: `demo.lead${i}@example.com`,
      state: DEMO_STATES[i % 10],
      lead_type: DEMO_TYPES[i % 6],
      source: "meta",
      status,
      notes: i <= 5 ? "No answer after 5 attempts." : (i > 5 && i <= 11 ? "Closed — policy submitted." : ""),
      received_at: new Date(Date.now() - (45 - i * 1.5) * 86400000).toISOString(),
    };
  }).reverse(); // newest first, like the DB query
  return demoLeads;
}

function getDemoSpend() {
  const out = [];
  for (let back = 89; back >= 0; back--) {
    const d = new Date(Date.now() - back * 86400000);
    const dow = d.getDay();
    const doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
    const spend = Math.max(20, 85 + 30 * Math.sin(doy / 5) + (dow === 0 || dow === 6 ? -25 : 0) + ((d.getDate() * 7) % 23));
    const leads = Math.max(0, Math.round(3 + 2 * Math.sin(doy / 4) + (d.getDate() % 3) - (dow === 0 || dow === 6 ? 1 : 0)));
    out.push({ entry_date: d.toISOString().slice(0, 10), spend: Math.round(spend * 100) / 100, leads_count: leads });
  }
  return out;
}

// ── CSV ──────────────────────────────────────────────────────
function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(typeof r[c] === "object" && r[c] !== null ? JSON.stringify(r[c]) : r[c])).join(","))].join("\n");
}

// ── Handler ──────────────────────────────────────────────────
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  const action = (event.queryStringParameters || {}).action;

  try {
    if (action === "login" && event.httpMethod === "POST") return await login(event);
    if (action === "bootstrap" && event.httpMethod === "GET") return await bootstrap(event);
    if (action === "update-lead" && event.httpMethod === "POST") return await updateLead(event);
    if (action === "export" && event.httpMethod === "GET") return await exportCsv(event);
    return json(400, { error: "Unknown action" });
  } catch (err) {
    console.error("launch-api error:", err);
    return json(500, { error: "Server error" });
  }
}

async function login(event) {
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return json(400, { error: "Invalid JSON" });
  }
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) return json(400, { error: "Email and password are required." });

  // Real account first — the demo login only falls back to the built-in
  // dataset when the database doesn't have it (or isn't set up yet).
  let client = null;
  let dbError = false;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    try {
      const { data, error } = await getSupabase()
        .from("launch_clients")
        .select("id, email, password_hash, full_name, agency_name, plan, billing_status, monthly_ad_budget, active")
        .eq("email", email)
        .maybeSingle();
      if (error) {
        console.error("launch login query error:", error.message);
        dbError = true;
      } else {
        client = data;
      }
    } catch (err) {
      console.error("launch login supabase error:", err);
      dbError = true;
    }
  } else {
    dbError = true;
  }

  if (client) {
    if (!client.active || !verifyPassword(password, client.password_hash)) {
      return json(401, { error: "Invalid email or password." });
    }
    const token = signToken({ sub: client.id, email: client.email, demo: false, exp: Date.now() + SESSION_TTL_MS });
    const { password_hash, ...safe } = client;
    return json(200, { token, client: safe });
  }

  // Demo fallback: only when the account isn't in the DB (or DB is down/unconfigured)
  if (DEMO_ENABLED && email === DEMO_EMAIL && password === DEMO_PASSWORD) {
    const token = signToken({ sub: "demo", email, demo: true, exp: Date.now() + SESSION_TTL_MS });
    console.log("launch-api: demo mode login (database " + (dbError ? "unavailable" : "has no demo user") + ")");
    return json(200, { token, client: DEMO_CLIENT, demo: true });
  }

  return json(401, { error: "Invalid email or password." });
}

async function requireClient(event) {
  const payload = verifyToken(bearer(event));
  if (!payload) return { error: json(401, { error: "Session expired. Please sign in again." }) };
  return { payload };
}

async function bootstrap(event) {
  const { payload, error } = await requireClient(event);
  if (error) return error;

  if (payload.demo) {
    return json(200, { client: DEMO_CLIENT, leads: getDemoLeads(), spend: getDemoSpend(), demo: true });
  }

  const supabase = getSupabase();
  const [clientRes, leadsRes, spendRes] = await Promise.all([
    supabase.from("launch_clients").select("id, email, full_name, agency_name, plan, billing_status, monthly_ad_budget").eq("id", payload.sub).single(),
    supabase.from("launch_leads").select("id, name, phone, email, state, lead_type, source, status, notes, received_at").eq("client_id", payload.sub).order("received_at", { ascending: false }).limit(500),
    supabase.from("launch_spend_entries").select("entry_date, spend, leads_count").eq("client_id", payload.sub).gte("entry_date", new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)).order("entry_date", { ascending: true }),
  ]);
  if (clientRes.error) return json(401, { error: "Account not found." });
  return json(200, {
    client: clientRes.data,
    leads: leadsRes.data || [],
    spend: spendRes.data || [],
  });
}

async function updateLead(event) {
  const { payload, error } = await requireClient(event);
  if (error) return error;

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return json(400, { error: "Invalid JSON" });
  }
  const { id, status } = body;
  const notes = body.notes === undefined ? undefined : String(body.notes).slice(0, 2000);
  if (!id || (status && !LEAD_STATUSES.includes(status))) return json(400, { error: "Invalid lead update." });

  if (payload.demo) {
    const lead = getDemoLeads().find((l) => l.id === id);
    if (!lead) return json(404, { error: "Lead not found." });
    if (status) lead.status = status;
    if (notes !== undefined) lead.notes = notes;
    return json(200, { ok: true, lead, demo: true });
  }

  const update = { updated_at: new Date().toISOString() };
  if (status) update.status = status;
  if (notes !== undefined) update.notes = notes;
  const { data, error: dbErr } = await getSupabase()
    .from("launch_leads")
    .update(update)
    .eq("id", id)
    .eq("client_id", payload.sub) // clients can only touch their own leads
    .select("id, status, notes")
    .maybeSingle();
  if (dbErr) return json(500, { error: "Update failed." });
  if (!data) return json(404, { error: "Lead not found." });
  return json(200, { ok: true, lead: data });
}

// Admin CSV export, gated by the same DASHBOARD_PIN the internal
// dashboard uses. Header X-Dashboard-Pin, or ?pin= for direct
// browser downloads.
async function exportCsv(event) {
  const pin = event.headers["x-dashboard-pin"] || (event.queryStringParameters || {}).pin;
  if (!process.env.DASHBOARD_PIN) return json(503, { error: "Set the DASHBOARD_PIN environment variable to enable exports." });
  if (pin !== process.env.DASHBOARD_PIN) return json(401, { error: "Invalid PIN" });

  const type = (event.queryStringParameters || {}).type || "submissions";
  let rows, columns, filename;
  try {
    if (type === "leads") {
      const { data, error } = await getSupabase().from("launch_leads").select("*").order("received_at", { ascending: false }).limit(5000);
      if (error) throw error;
      rows = data;
      columns = ["id", "client_id", "name", "phone", "email", "state", "lead_type", "source", "status", "notes", "received_at"];
      filename = "launch-leads.csv";
    } else if (type === "submissions") {
      const { data, error } = await getSupabase().from("launch_submissions").select("*").order("created_at", { ascending: false }).limit(5000);
      if (error) throw error;
      rows = data;
      columns = ["id", "form_type", "name", "email", "phone", "payload", "ip", "created_at"];
      filename = "launch-submissions.csv";
    } else {
      return json(400, { error: "type must be leads or submissions" });
    }
  } catch (err) {
    console.error("launch export error:", err);
    return json(500, { error: "Export failed — are the launch_ tables created? Run supabase/launch_schema.sql." });
  }

  return {
    statusCode: 200,
    headers: {
      ...CORS,
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
    body: toCsv(rows, columns),
  };
}
