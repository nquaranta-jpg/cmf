#!/usr/bin/env node
// Update a prospect's status so the sequence stops (or resumes).
//
//   node mark.js replied jane@brokerage.com [more@emails...]
//   node mark.js unsubscribed bob@realty.com
//   node mark.js active carol@homes.com        (resume a paused contact)
//
// Run this whenever you check the inbox: replies and "unsubscribe" requests
// must be marked or they'll keep getting follow-ups.
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'state.json');
const [status, ...emails] = process.argv.slice(2);

if (!['replied', 'unsubscribed', 'active', 'bounced'].includes(status) || !emails.length) {
  console.error('Usage: node mark.js <replied|unsubscribed|bounced|active> <email> [email...]');
  process.exit(1);
}

const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
for (const raw of emails) {
  const email = raw.trim().toLowerCase();
  state[email] = { step: 0, ...state[email], status, markedAt: new Date().toISOString() };
  console.log(`${email} → ${status}`);
}
fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
