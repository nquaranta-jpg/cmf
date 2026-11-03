// Builds each agent's contact card at /card/<slug>/ from Nick's live card (/card/index.html).
// Add or edit an agent in scripts/card-agents.json, then run: node scripts/build-cards.mjs
// An agent without a phone number or NPN is skipped so an incomplete card never goes live.
// New agents also need their /card/<slug> redirect and vCard header in netlify.toml.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = 'https://crownmerchantfinancial.com';
const require = createRequire(import.meta.url);
const agents = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/card-agents.json'), 'utf8'));
const source = fs.readFileSync(path.join(ROOT, 'card/index.html'), 'utf8');

function swap(html, from, to, label = from) {
  if (!html.includes(from)) throw new Error(`Nick's card no longer contains: ${label}`);
  return html.split(from).join(to);
}

function buildPage(a) {
  const url = `${SITE}/card/${a.slug}/`;
  const desc = `${a.name}, Crown Merchant Financial. Tap to open my card and save my contact.`;
  let h = source;
  h = swap(h, 'Founder of Crown Merchant Financial. Tap to open my card and save my contact.', desc);
  h = swap(h, 'https://crownmerchantfinancial.com/card/preview.png', `${url}preview.png`);
  h = swap(h, 'https://crownmerchantfinancial.com/card/', url);
  h = swap(h, 'Nicholas Quaranta', a.name);
  h = swap(h, 'Founder and Managing Member · Life insurance', `${a.title} · Life insurance`);
  h = swap(h, '(312) 203-8106', a.phoneDisplay);
  h = swap(h, 'nquaranta@crownmerchantfinancial.com', a.email);
  h = swap(h, 'NPN 22145269', `NPN ${a.npn}`);
  h = swap(h, '<div class="mark" aria-hidden="true">NQ</div>', `<div class="mark" aria-hidden="true">${a.first[0]}${a.last[0]}</div>`);
  h = swap(h, '/card/nick.vcf', `/card/${a.slug}/contact.vcf`);
  h = swap(h, 'Nick Quaranta here', `${a.first} ${a.last} here`);
  h = swap(h, 'nq-sender', `card-sender-${a.slug}`);
  h = swap(h, "marks this phone as Nick's", `marks this phone as ${a.first}'s`);
  h = swap(h, 'href="tel:+13122038106"', `href="tel:${a.phone}"`);
  if (a.canText) h = swap(h, 'href="sms:+13122038106"', `href="sms:${a.phone}"`);
  else h = swap(h, '      <a class="btn" href="sms:+13122038106">Text</a>\n', '');
  for (const leak of ['Nick', 'Quaranta', '22145269', '2038106']) {
    if (h.includes(leak)) throw new Error(`${a.slug}: card still mentions ${leak}`);
  }
  return h;
}

function buildVcf(a) {
  return ['BEGIN:VCARD', 'VERSION:3.0', `N:${a.last};${a.first};;;`, `FN:${a.name}`,
    'ORG:Crown Merchant Financial LLC', `TITLE:${a.title}`, `TEL;TYPE=WORK,VOICE:${a.phone}`,
    `EMAIL;TYPE=WORK,INTERNET:${a.email}`, `URL:${SITE}/card/${a.slug}/`,
    `NOTE:Life insurance. NPN ${a.npn}.`, 'END:VCARD', ''].join('\r\n');
}

const ready = agents.filter((a) => a.phone && a.phoneDisplay && a.npn);
for (const a of agents.filter((x) => !ready.includes(x))) console.log(`Skipped ${a.name}: needs a phone number and NPN.`);
for (const a of ready) {
  const dir = path.join(ROOT, 'card', a.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), buildPage(a));
  fs.writeFileSync(path.join(dir, 'contact.vcf'), buildVcf(a));
}

// Link preview image and Home Screen icon for each card. Needs Playwright on the machine running this.
const { chromium } = require('playwright');
const srv = http.createServer((q, r) => {
  let p = q.url.split('?')[0]; if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(ROOT, p), (e, d) => {
    if (e) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(d);
  });
}).listen(0);
const base = `http://localhost:${srv.address().port}`;
const browser = await chromium.launch();
const shot = async (a, width, height, css, file) => {
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  await page.goto(`${base}/card/${a.slug}/`); await page.waitForTimeout(500);
  await page.addStyleTag({ content: css });
  await page.evaluate(() => dispatchEvent(new Event('resize'))); await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(ROOT, 'card', a.slug, file) });
};
for (const a of ready) {
  await shot(a, 1200, 630, '.sheet{display:none!important}body{padding:0!important;height:630px;overflow:hidden}.wrap{display:flex!important;max-width:none;height:630px;align-items:center;justify-content:center}.scene{width:340px!important;flex:none}', 'preview.png');
  await shot(a, 180, 180, '.sheet,.who,.co{display:none!important}body{padding:0!important;overflow:hidden}.wrap{display:block!important;max-width:none}.scene{width:300px!important;margin:-73px 0 0 -60px}.card{border-radius:0!important;box-shadow:none}', 'icon.png');
  console.log(`Built ${SITE}/card/${a.slug}/`);
}
await browser.close(); srv.close();
