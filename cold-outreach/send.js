#!/usr/bin/env node
// Throttled cold-outreach sender for realtor referral prospecting.
//
//   node send.js --dry-run     show who would get what today, send nothing
//   node send.js               send today's batch (throttled, with delays)
//   node send.js --contacts realtors.csv
//
// Run once per day (manually or via cron). It sends at most DAILY_LIMIT
// emails per calendar day no matter how many times it's invoked, works
// follow-ups before new contacts, and records everything in state.json.
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { loadEnv, loadContacts, render, parseTemplate } = require('./lib');

// Sequence: file + days to wait after the previous touch before sending.
const SEQUENCE = [
  { file: '01-intro.txt', delayDays: 0 },
  { file: '02-follow-up.txt', delayDays: 4 },
  { file: '03-final.txt', delayDays: 5 },
];

const DIR = __dirname;
const STATE_FILE = path.join(DIR, 'state.json');

// ---------- helpers ----------
function loadTemplate(name) {
  return parseTemplate(fs.readFileSync(path.join(DIR, 'sequence', name), 'utf8'), name);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const daysSince = (iso) => (Date.now() - new Date(iso).getTime()) / 86400000;
const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();

// ---------- main ----------
async function main() {
  loadEnv(DIR);
  const dryRun = process.argv.includes('--dry-run');
  const contactsFile = process.argv.includes('--contacts')
    ? process.argv[process.argv.indexOf('--contacts') + 1]
    : path.join(DIR, 'realtors.csv');

  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'FROM_EMAIL', 'FROM_NAME', 'POSTAL_ADDRESS']) {
    if (!process.env[key] && !dryRun) {
      console.error(`Missing ${key} in .env (copy .env.example). POSTAL_ADDRESS is required by CAN-SPAM.`);
      process.exit(1);
    }
  }

  const contacts = loadContacts(contactsFile);
  const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
  const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  const dailyLimit = parseInt(process.env.DAILY_LIMIT || '30', 10);
  const sentToday = Object.values(state).filter((s) => s.lastSentAt && isToday(s.lastSentAt)).length;
  let budget = Math.max(0, dailyLimit - sentToday);

  // Build today's queue: due follow-ups first (oldest last-touch first), then new contacts.
  const followUps = [];
  const fresh = [];
  for (const c of contacts) {
    const s = state[c.email] || { step: 0, status: 'active' };
    if (s.status !== 'active') continue;
    if (s.step === 0) fresh.push({ c, s });
    else if (s.step < SEQUENCE.length && daysSince(s.lastSentAt) >= SEQUENCE[s.step].delayDays) followUps.push({ c, s });
  }
  followUps.sort((a, b) => new Date(a.s.lastSentAt) - new Date(b.s.lastSentAt));
  const queue = [...followUps, ...fresh].slice(0, budget);

  const done = Object.values(state).filter((s) => s.step >= SEQUENCE.length || s.status !== 'active').length;
  console.log(`Contacts: ${contacts.length} | finished/inactive: ${done} | due follow-ups: ${followUps.length} | not yet contacted: ${fresh.length}`);
  console.log(`Daily limit ${dailyLimit}, already sent today ${sentToday} → sending up to ${queue.length} now.\n`);

  if (!queue.length) { console.log('Nothing to send today.'); return; }

  const envVars = {
    from_name: process.env.FROM_NAME || '',
    from_email: process.env.FROM_EMAIL || '',
    postal_address: process.env.POSTAL_ADDRESS || '',
    phone: process.env.PHONE || '',
  };

  if (dryRun) {
    for (const { c, s } of queue) {
      const t = loadTemplate(SEQUENCE[s.step].file);
      console.log(`[step ${s.step + 1}] ${c.email} — "${render(t.subject, { ...envVars, ...c })}"`);
    }
    console.log('\nDry run only — nothing sent. First email preview:\n');
    const { c, s } = queue[0];
    const t = loadTemplate(SEQUENCE[s.step].file);
    console.log(render(t.body, { ...envVars, ...c }));
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: (process.env.SMTP_PORT || '587') === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.verify();

  let sent = 0, failed = 0;
  for (const [i, { c, s }] of queue.entries()) {
    const t = loadTemplate(SEQUENCE[s.step].file);
    const vars = { ...envVars, ...c };
    try {
      await transporter.sendMail({
        from: `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`,
        to: c.email,
        subject: render(t.subject, vars),
        text: render(t.body, vars),
        headers: {
          'List-Unsubscribe': `<mailto:${process.env.FROM_EMAIL}?subject=unsubscribe>`,
        },
      });
      state[c.email] = { ...s, step: s.step + 1, status: 'active', lastSentAt: new Date().toISOString() };
      sent++;
      console.log(`sent step ${s.step + 1} → ${c.email} (${sent}/${queue.length})`);
    } catch (e) {
      state[c.email] = { ...s, status: 'error', lastError: e.message };
      failed++;
      console.error(`FAILED ${c.email}: ${e.message}`);
    }
    saveState();
    if (i < queue.length - 1) {
      await sleep(45000 + Math.random() * 75000); // 45–120s between sends, human-ish pacing
    }
  }
  console.log(`\nDone: ${sent} sent, ${failed} failed. Check the inbox for replies and run mark.js on them.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
