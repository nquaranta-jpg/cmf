// Minimal Brevo (Sendinblue) API client using native fetch. Requires Node 18+.
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.brevo.com/v3';

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

loadEnv();

async function api(method, endpoint, body) {
  const key = process.env.BREVO_API_KEY;
  if (!key) {
    console.error('Missing BREVO_API_KEY. Copy .env.example to .env and add your key.');
    process.exit(1);
  }
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: {
      'api-key': key,
      'accept': 'application/json',
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`Brevo ${method} ${endpoint} failed (${res.status}): ${data.message || text}`);
  }
  return data;
}

// Find a contact list by name, or create it (in the first available folder).
async function getOrCreateList(name) {
  const lists = await api('GET', '/contacts/lists?limit=50');
  const existing = (lists.lists || []).find((l) => l.name === name);
  if (existing) return existing.id;

  const folders = await api('GET', '/contacts/folders?limit=10');
  let folderId = folders.folders?.[0]?.id;
  if (!folderId) {
    folderId = (await api('POST', '/contacts/folders', { name: 'CMF' })).id;
  }
  const created = await api('POST', '/contacts/lists', { name, folderId });
  console.log(`Created new Brevo list "${name}" (id ${created.id})`);
  return created.id;
}

module.exports = { api, getOrCreateList };
