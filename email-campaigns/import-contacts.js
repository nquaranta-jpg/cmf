#!/usr/bin/env node
// Import contacts from a CSV file into a Brevo list.
// Usage: node import-contacts.js contacts.csv --list "CMF Clients"
const fs = require('fs');
const { api, getOrCreateList } = require('./brevo');

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f.trim() !== '')) rows.push(row); }
  return rows;
}

function findCol(headers, ...names) {
  return headers.findIndex((h) => names.includes(h.toLowerCase().replace(/[\s_-]/g, '')));
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const listName = args.includes('--list') ? args[args.indexOf('--list') + 1] : 'CMF Clients';
  if (!file) {
    console.error('Usage: node import-contacts.js <contacts.csv> [--list "CMF Clients"]');
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const headers = rows.shift().map((h) => h.trim());
  const emailCol = findCol(headers, 'email', 'emailaddress');
  const firstCol = findCol(headers, 'firstname', 'first');
  const lastCol = findCol(headers, 'lastname', 'last');
  if (emailCol === -1) {
    console.error(`No email column found. Headers: ${headers.join(', ')}`);
    process.exit(1);
  }

  const seen = new Set();
  const contacts = [];
  let skipped = 0;
  for (const r of rows) {
    const email = (r[emailCol] || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seen.has(email)) { skipped++; continue; }
    seen.add(email);
    const attributes = {};
    if (firstCol !== -1 && r[firstCol]) attributes.FIRSTNAME = r[firstCol].trim();
    if (lastCol !== -1 && r[lastCol]) attributes.LASTNAME = r[lastCol].trim();
    contacts.push({ email, attributes });
  }

  if (!contacts.length) {
    console.error('No valid contacts found in file.');
    process.exit(1);
  }

  const listId = await getOrCreateList(listName);
  const job = await api('POST', '/contacts/import', {
    jsonBody: contacts,
    listIds: [listId],
    updateExistingContacts: true,
    emptyContactsAttributes: false,
  });

  console.log(`Queued import of ${contacts.length} contacts into "${listName}" (${skipped} rows skipped as invalid/duplicate).`);
  console.log(`Brevo import process id: ${job.processId}. Large imports finish within a minute or two.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
