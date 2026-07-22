#!/usr/bin/env node
// Manage the Netlify-hosted outreach from your machine.
//
//   node netlify-sync.js push                 upload realtors.csv + sequence/ to Netlify Blobs
//   node netlify-sync.js status               show progress (sent counts, replies, errors)
//   node netlify-sync.js mark replied <email> stop the sequence for someone (also: unsubscribed|bounced|active)
//
// Needs NETLIFY_AUTH_TOKEN in .env (app.netlify.com > User settings >
// Applications > Personal access tokens). Site ID is read from ../.netlify.
const fs = require('fs');
const path = require('path');
const { loadEnv, loadContacts } = require('./lib');

const DIR = __dirname;
const SEQUENCE_FILES = ['01-intro.txt', '02-follow-up.txt', '03-final.txt'];

async function getOutreachStore() {
  loadEnv(DIR);
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!token) {
    console.error('Missing NETLIFY_AUTH_TOKEN in .env — create one at app.netlify.com > User settings > Applications.');
    process.exit(1);
  }
  const siteID = JSON.parse(fs.readFileSync(path.join(DIR, '..', '.netlify', 'state.json'), 'utf8')).siteId;
  const { getStore } = await import('@netlify/blobs');
  return getStore({ name: 'outreach', siteID, token });
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const store = await getOutreachStore();

  if (cmd === 'push') {
    const file = rest.includes('--contacts') ? rest[rest.indexOf('--contacts') + 1] : path.join(DIR, 'realtors.csv');
    const contacts = loadContacts(file);
    const sequence = SEQUENCE_FILES.map((f) => fs.readFileSync(path.join(DIR, 'sequence', f), 'utf8'));
    await store.setJSON('contacts', contacts);
    await store.setJSON('sequence', sequence);
    console.log(`Pushed ${contacts.length} contacts and ${sequence.length} sequence templates.`);
    console.log('Existing send state is preserved — new contacts start at step 1.');
  } else if (cmd === 'status') {
    const [contacts, state] = await Promise.all([
      store.get('contacts', { type: 'json' }).then((c) => c || []),
      store.get('state', { type: 'json' }).then((s) => s || {}),
    ]);
    const counts = {};
    for (const s of Object.values(state)) {
      const key = s.status === 'active' ? `active (step ${s.step} sent)` : s.status;
      counts[key] = (counts[key] || 0) + 1;
    }
    const touched = Object.keys(state).length;
    console.log(`Contacts uploaded: ${contacts.length} | not yet contacted: ${contacts.length - touched}`);
    for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k}: ${v}`);
    const errors = Object.entries(state).filter(([, s]) => s.status === 'error');
    for (const [email, s] of errors) console.log(`  ERROR ${email}: ${s.lastError}`);
  } else if (cmd === 'mark') {
    const [status, ...emails] = rest;
    if (!['replied', 'unsubscribed', 'bounced', 'active'].includes(status) || !emails.length) {
      console.error('Usage: node netlify-sync.js mark <replied|unsubscribed|bounced|active> <email> [email...]');
      process.exit(1);
    }
    const state = (await store.get('state', { type: 'json' })) || {};
    for (const raw of emails) {
      const email = raw.trim().toLowerCase();
      state[email] = { step: 0, ...state[email], status, markedAt: new Date().toISOString() };
      console.log(`${email} → ${status}`);
    }
    await store.setJSON('state', state);
  } else {
    console.error('Usage: node netlify-sync.js <push|status|mark> ...');
    process.exit(1);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
