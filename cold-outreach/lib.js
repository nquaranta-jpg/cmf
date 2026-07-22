// Shared helpers for the cold-outreach CLI tools (send.js, netlify-sync.js).
const fs = require('fs');
const path = require('path');

function loadEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

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

function loadContacts(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const headers = rows.shift().map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const emailCol = headers.indexOf('email');
  if (emailCol === -1) throw new Error(`No "email" column in ${file}. Headers: ${headers.join(', ')}`);
  const seen = new Set();
  const contacts = [];
  for (const r of rows) {
    const email = (r[emailCol] || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seen.has(email)) continue;
    seen.add(email);
    const c = { email };
    headers.forEach((h, i) => { if (r[i]) c[h] = r[i].trim(); });
    contacts.push(c);
  }
  return contacts;
}

// Placeholders: {{field}} or {{field|fallback}}.
function render(templateText, vars) {
  return templateText.replace(/\{\{\s*([a-z0-9_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/gi, (_, key, fallback) => {
    const v = vars[key.toLowerCase()];
    return v != null && v !== '' ? v : (fallback ?? '');
  });
}

// Templates: first line "Subject: ...", blank line, plain-text body.
function parseTemplate(raw, name) {
  const m = raw.match(/^Subject:\s*(.+)\r?\n\r?\n([\s\S]*)$/);
  if (!m) throw new Error(`${name} must start with "Subject: ..." followed by a blank line.`);
  return { subject: m[1].trim(), body: m[2] };
}

module.exports = { loadEnv, parseCsv, loadContacts, render, parseTemplate };
