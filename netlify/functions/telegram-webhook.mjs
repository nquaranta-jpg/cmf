import { getSupabase } from "./lib/supabase.mjs";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

async function telegramAPI(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  // Verify webhook secret
  const secret = event.headers["x-telegram-bot-api-secret-token"];
  if (TELEGRAM_WEBHOOK_SECRET && secret !== TELEGRAM_WEBHOOK_SECRET) {
    console.error("Invalid webhook secret");
    return { statusCode: 403, body: "Forbidden" };
  }

  let update;
  try {
    update = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  // Handle /register command — agents send this to get their Telegram user ID
  if (update.message && update.message.text === "/register") {
    const user = update.message.from;
    const supabase = getSupabase();

    // Try to link this Telegram user to an agent
    const { data: agent } = await supabase
      .from("agents")
      .select("id, name, telegram_user_id")
      .is("telegram_user_id", null)
      .limit(1)
      .single();

    if (agent) {
      // Auto-link to first unlinked agent (manual override later if needed)
      await telegramAPI("sendMessage", {
        chat_id: update.message.chat.id,
        text: `Your Telegram ID is: ${user.id}\nName: ${user.first_name} ${user.last_name || ""}\n\nAsk Nick to link this ID to your agent profile.`,
      });
    } else {
      await telegramAPI("sendMessage", {
        chat_id: update.message.chat.id,
        text: `Your Telegram ID is: ${user.id}\nAll agents are already registered.`,
      });
    }

    return { statusCode: 200, body: "OK" };
  }

  // Handle CLAIM button press (callback_query)
  if (!update.callback_query) {
    return { statusCode: 200, body: "OK" };
  }

  const callbackQuery = update.callback_query;
  const callbackData = callbackQuery.data;

  if (!callbackData || !callbackData.startsWith("claim:")) {
    await telegramAPI("answerCallbackQuery", {
      callback_query_id: callbackQuery.id,
      text: "Unknown action",
    });
    return { statusCode: 200, body: "OK" };
  }

  const leadId = callbackData.replace("claim:", "");
  const telegramUserId = callbackQuery.from.id;
  const telegramName = `${callbackQuery.from.first_name || ""} ${callbackQuery.from.last_name || ""}`.trim();

  const supabase = getSupabase();

  // Look up the agent by Telegram user ID
  let { data: agent } = await supabase
    .from("agents")
    .select("id, name")
    .eq("telegram_user_id", telegramUserId)
    .eq("active", true)
    .single();

  // If agent not found by telegram_user_id, check if it's Nick (owner) by name match
  if (!agent) {
    // Allow claiming even if telegram_user_id isn't linked yet — use the Telegram name
    // But still register the telegram_user_id for future lookups
    const { data: agents } = await supabase
      .from("agents")
      .select("id, name, telegram_user_id")
      .eq("active", true);

    // Try to find by matching first name
    const firstName = callbackQuery.from.first_name?.toLowerCase();
    agent = agents?.find(a =>
      a.name.toLowerCase().startsWith(firstName) || a.telegram_user_id === telegramUserId
    );

    if (agent && !agent.telegram_user_id) {
      // Auto-link telegram user ID
      await supabase.from("agents").update({ telegram_user_id: telegramUserId }).eq("id", agent.id);
      console.log(`Auto-linked Telegram user ${telegramUserId} to agent ${agent.name}`);
    }
  }

  const agentName = agent?.name || telegramName;
  const agentId = agent?.id || null;

  // Atomic claim — only succeeds if lead is still unclaimed
  const now = new Date().toISOString();
  const { data: claimed, error } = await supabase
    .from("leads")
    .update({
      status: "claimed",
      claimed_by: agentId,
      claimed_at: now,
      claim_source: "telegram",
    })
    .eq("id", leadId)
    .eq("status", "unclaimed")
    .select("*, agents:claimed_by(name)")
    .single();

  if (error || !claimed) {
    // Already claimed by someone else
    const { data: existingLead } = await supabase
      .from("leads")
      .select("*, agents:claimed_by(name)")
      .eq("id", leadId)
      .single();

    const claimedByName = existingLead?.agents?.name || "someone";

    await telegramAPI("answerCallbackQuery", {
      callback_query_id: callbackQuery.id,
      text: `Already claimed by ${claimedByName}!`,
      show_alert: true,
    });

    return { statusCode: 200, body: "OK" };
  }

  // Calculate response time
  const responseSeconds = Math.round((new Date(now) - new Date(claimed.created_at)) / 1000);
  await supabase.from("leads").update({ response_time_seconds: responseSeconds }).eq("id", leadId);

  // Success — answer the callback
  await telegramAPI("answerCallbackQuery", {
    callback_query_id: callbackQuery.id,
    text: `You claimed this lead! Call ${claimed.name || "them"} now!`,
    show_alert: true,
  });

  // Edit the original message to show who claimed it
  const responseMinutes = Math.floor(responseSeconds / 60);
  const responseLabel = responseMinutes > 0 ? `${responseMinutes}m ${responseSeconds % 60}s` : `${responseSeconds}s`;

  const updatedMessage =
    `✅ *CLAIMED by ${agentName}* (${responseLabel})\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 *Name:* ${claimed.name || "—"}\n` +
    `📱 *Phone:* ${claimed.phone || "—"}\n` +
    `📧 *Email:* ${claimed.email || "—"}\n` +
    `🎂 *Age:* ${claimed.age_range || "—"} | 💰 $${claimed.coverage_amount ? Number(claimed.coverage_amount).toLocaleString() : "—"}\n` +
    `⏱️ *Timeline:* ${claimed.timeline || "—"}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📞 *Call them NOW!*`;

  await telegramAPI("editMessageText", {
    chat_id: claimed.telegram_chat_id,
    message_id: claimed.telegram_message_id,
    text: updatedMessage,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [] }, // Remove the CLAIM button
  });

  console.log(`Lead ${leadId} claimed by ${agentName} (${agentId}) in ${responseSeconds}s`);

  return { statusCode: 200, body: "OK" };
}
