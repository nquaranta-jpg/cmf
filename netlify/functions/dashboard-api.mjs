import { getSupabase } from "./lib/supabase.mjs";

// Fail closed: the dashboard is disabled until DASHBOARD_PIN is set in
// Netlify env vars. A hardcoded fallback here would be readable by anyone
// with repo access and gates every lead's name/phone/email.
const DASHBOARD_PIN = process.env.DASHBOARD_PIN;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Dashboard-Pin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function verifyPin(event) {
  if (!DASHBOARD_PIN) return false;
  const pin = event.headers["x-dashboard-pin"];
  return pin === DASHBOARD_PIN;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  // Distinguish "not configured" from "wrong PIN" so an unset env var is
  // diagnosable instead of looking like a login failure.
  if (!DASHBOARD_PIN) {
    return {
      statusCode: 503,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Dashboard not configured: set the DASHBOARD_PIN environment variable in Netlify." }),
    };
  }

  if (!verifyPin(event)) {
    return { statusCode: 401, headers: corsHeaders(), body: JSON.stringify({ error: "Invalid PIN" }) };
  }

  const params = event.queryStringParameters || {};
  const action = params.action;
  const supabase = getSupabase();

  try {
    // ── GET actions ──
    if (event.httpMethod === "GET") {

      // List leads
      if (action === "leads") {
        let query = supabase
          .from("leads")
          .select("*, agents:claimed_by(name)")
          .order("created_at", { ascending: false })
          .limit(100);

        if (params.status) query = query.eq("status", params.status);
        if (params.agent) query = query.eq("claimed_by", params.agent);
        if (params.from) query = query.gte("created_at", params.from);
        if (params.to) query = query.lte("created_at", params.to);

        const { data, error } = await query;
        if (error) throw error;
        return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(data) };
      }

      // List agents
      if (action === "agents") {
        const { data, error } = await supabase
          .from("agents")
          .select("id, name, is_owner, active")
          .eq("active", true)
          .order("name");

        if (error) throw error;
        return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(data) };
      }

      // Stats
      if (action === "stats") {
        const period = params.period || "week";
        let since;
        const now = new Date();
        if (period === "week") since = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
        else if (period === "month") since = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
        else since = "2020-01-01T00:00:00Z";

        // Get all leads in period
        const { data: leads } = await supabase
          .from("leads")
          .select("*, agents:claimed_by(name)")
          .gte("created_at", since);

        // Get all agents
        const { data: agents } = await supabase
          .from("agents")
          .select("id, name, is_owner")
          .eq("active", true);

        // Calculate stats per agent
        const agentStats = agents.map(agent => {
          const agentLeads = leads.filter(l => l.claimed_by === agent.id);
          const responseTimes = agentLeads
            .filter(l => l.response_time_seconds != null)
            .map(l => l.response_time_seconds);

          return {
            id: agent.id,
            name: agent.name,
            is_owner: agent.is_owner,
            total_claims: agentLeads.length,
            avg_response_seconds: responseTimes.length
              ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
              : null,
            fastest_response: responseTimes.length ? Math.min(...responseTimes) : null,
          };
        });

        const totalLeads = leads.length;
        const unclaimed = leads.filter(l => l.status === "unclaimed").length;
        const escalated = leads.filter(l => l.status === "escalated").length;
        const claimed = leads.filter(l => l.status === "claimed").length;

        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({
            period,
            total_leads: totalLeads,
            claimed,
            unclaimed,
            escalated,
            agents: agentStats.sort((a, b) => b.total_claims - a.total_claims),
          }),
        };
      }

      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Unknown action" }) };
    }

    // ── POST actions ──
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");

      // Claim from dashboard
      if (action === "claim") {
        const { lead_id, agent_id } = body;
        if (!lead_id || !agent_id) {
          return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "lead_id and agent_id required" }) };
        }

        const now = new Date().toISOString();
        const { data: claimed, error } = await supabase
          .from("leads")
          .update({
            status: "claimed",
            claimed_by: agent_id,
            claimed_at: now,
            claim_source: "dashboard",
          })
          .eq("id", lead_id)
          .eq("status", "unclaimed")
          .select("*, agents:claimed_by(name)")
          .single();

        if (error || !claimed) {
          return { statusCode: 409, headers: corsHeaders(), body: JSON.stringify({ error: "Lead already claimed" }) };
        }

        // Calculate response time
        const responseSeconds = Math.round((new Date(now) - new Date(claimed.created_at)) / 1000);
        await supabase.from("leads").update({ response_time_seconds: responseSeconds }).eq("id", lead_id);

        // Update Telegram message if possible
        if (claimed.telegram_message_id && claimed.telegram_chat_id) {
          const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
          const agentName = claimed.agents?.name || "Agent";
          const responseLabel = responseSeconds > 60
            ? `${Math.floor(responseSeconds / 60)}m ${responseSeconds % 60}s`
            : `${responseSeconds}s`;

          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: claimed.telegram_chat_id,
              message_id: claimed.telegram_message_id,
              text: `✅ *CLAIMED by ${agentName}* via dashboard (${responseLabel})\n━━━━━━━━━━━━━━━━━━\n👤 ${claimed.name || "—"} | 📱 ${claimed.phone || "—"}\n📞 *Call them NOW!*`,
              parse_mode: "Markdown",
              reply_markup: { inline_keyboard: [] },
            }),
          });
        }

        return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true, lead: claimed }) };
      }

      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Unknown action" }) };
    }

    return { statusCode: 405, headers: corsHeaders(), body: "Method not allowed" };
  } catch (err) {
    console.error("Dashboard API error:", err);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
}
