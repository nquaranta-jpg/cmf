// Scheduled cold-outreach sender — the serverless version of cold-outreach/send.js.
//
// Fires every 10 minutes, 13:00–21:59 UTC weekdays (≈ 9am–6pm ET) and sends
// ONE email per run — pacing comes from the schedule, not sleeps. Contacts,
// sequence templates, and per-contact state live in the "outreach" Netlify
// Blobs store, managed from cold-outreach/netlify-sync.js.
//
// Inert until the OUTREACH_ENABLED env var is exactly "true".
import nodemailer from 'nodemailer';
import { getStore } from '@netlify/blobs';

export const config = { schedule: '*/10 13-21 * * 1-5' };

// Days to wait after the previous touch before each step (index = step).
const STEP_DELAYS = [0, 4, 5];

const daysSince = (iso) => (Date.now() - new Date(iso).getTime()) / 86400000;
const isTodayUtc = (iso) => iso && iso.slice(0, 10) === new Date().toISOString().slice(0, 10);

function render(templateText, vars) {
  return templateText.replace(/\{\{\s*([a-z0-9_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/gi, (_, key, fallback) => {
    const v = vars[key.toLowerCase()];
    return v != null && v !== '' ? v : (fallback ?? '');
  });
}

function parseTemplate(raw, name) {
  const m = raw.match(/^Subject:\s*(.+)\r?\n\r?\n([\s\S]*)$/);
  if (!m) throw new Error(`Template "${name}" must start with "Subject: ..." then a blank line.`);
  return { subject: m[1].trim(), body: m[2] };
}

export default async () => {
  if (process.env.OUTREACH_ENABLED !== 'true') {
    return new Response('outreach disabled (set OUTREACH_ENABLED=true to run)');
  }

  const store = getStore('outreach');
  const [contacts, sequence, state] = await Promise.all([
    store.get('contacts', { type: 'json' }),
    store.get('sequence', { type: 'json' }),
    store.get('state', { type: 'json' }).then((s) => s || {}),
  ]);
  if (!contacts?.length || !sequence?.length) {
    return new Response('no contacts/sequence uploaded — run: node cold-outreach/netlify-sync.js push');
  }

  const dailyLimit = parseInt(process.env.DAILY_LIMIT || '30', 10);
  const sentToday = Object.values(state).filter((s) => isTodayUtc(s.lastSentAt)).length;
  if (sentToday >= dailyLimit) return new Response(`daily limit reached (${sentToday}/${dailyLimit})`);

  // Due follow-ups first (oldest last-touch first), then fresh contacts.
  const followUps = [];
  const fresh = [];
  for (const c of contacts) {
    const s = state[c.email] || { step: 0, status: 'active' };
    if (s.status !== 'active') continue;
    if (s.step === 0) fresh.push({ c, s });
    else if (s.step < sequence.length && daysSince(s.lastSentAt) >= STEP_DELAYS[s.step]) followUps.push({ c, s });
  }
  followUps.sort((a, b) => new Date(a.s.lastSentAt) - new Date(b.s.lastSentAt));
  const next = followUps[0] || fresh[0];
  if (!next) return new Response('nothing due');

  const { c, s } = next;
  const t = parseTemplate(sequence[s.step], `step ${s.step + 1}`);
  const vars = {
    from_name: process.env.FROM_NAME || '',
    from_email: process.env.FROM_EMAIL || '',
    postal_address: process.env.POSTAL_ADDRESS || '',
    phone: process.env.PHONE || '',
    ...c,
  };

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: (process.env.SMTP_PORT || '587') === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  try {
    await transporter.sendMail({
      from: `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`,
      to: c.email,
      subject: render(t.subject, vars),
      text: render(t.body, vars),
      headers: { 'List-Unsubscribe': `<mailto:${process.env.FROM_EMAIL}?subject=unsubscribe>` },
    });
    state[c.email] = { ...s, step: s.step + 1, status: 'active', lastSentAt: new Date().toISOString() };
    await store.setJSON('state', state);
    console.log(`sent step ${s.step + 1} to ${c.email} (${sentToday + 1}/${dailyLimit} today)`);
    return new Response(`sent step ${s.step + 1} to ${c.email}`);
  } catch (e) {
    state[c.email] = { ...s, status: 'error', lastError: e.message };
    await store.setJSON('state', state);
    console.error(`send failed for ${c.email}: ${e.message}`);
    return new Response(`failed: ${e.message}`, { status: 500 });
  }
};
