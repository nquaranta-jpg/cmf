#!/usr/bin/env node
// Create (and optionally send) a Brevo email campaign to a contact list.
//
// Usage:
//   node send-campaign.js --subject "July Update" --template templates/newsletter.html
//   node send-campaign.js --subject "..." --template ... --test you@example.com
//   node send-campaign.js --subject "..." --template ... --send-now
//   node send-campaign.js --subject "..." --template ... --schedule "2026-07-25T09:00:00-04:00"
//
// Without --send-now/--schedule, the campaign is created as a DRAFT you can
// preview and send from the Brevo dashboard.
const fs = require('fs');
const path = require('path');
const { api, getOrCreateList } = require('./brevo');

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

async function main() {
  const subject = arg('--subject');
  const templateFile = arg('--template', path.join(__dirname, 'templates', 'newsletter.html'));
  const listName = arg('--list', 'CMF Clients');
  const testEmail = arg('--test');
  const scheduleAt = arg('--schedule');
  const sendNow = process.argv.includes('--send-now');

  if (!subject) {
    console.error('Usage: node send-campaign.js --subject "..." [--template file.html] [--list "CMF Clients"] [--test you@x.com | --send-now | --schedule ISO-date]');
    process.exit(1);
  }

  const senderName = process.env.SENDER_NAME || 'Crown Merchant Financial';
  const senderEmail = process.env.SENDER_EMAIL;
  if (!senderEmail) {
    console.error('Missing SENDER_EMAIL in .env — must be a sender verified in Brevo (Settings > Senders).');
    process.exit(1);
  }

  const htmlContent = fs.readFileSync(templateFile, 'utf8');
  const listId = await getOrCreateList(listName);

  const campaign = await api('POST', '/emailCampaigns', {
    name: `${subject} — ${new Date().toISOString().slice(0, 10)}`,
    subject,
    sender: { name: senderName, email: senderEmail },
    htmlContent,
    recipients: { listIds: [listId] },
    inlineImageActivation: false,
    ...(scheduleAt ? { scheduledAt: scheduleAt } : {}),
  });
  console.log(`Campaign created (id ${campaign.id}) targeting list "${listName}".`);

  if (testEmail) {
    await api('POST', `/emailCampaigns/${campaign.id}/sendTest`, { emailTo: [testEmail] });
    console.log(`Test email sent to ${testEmail}. Campaign remains a draft.`);
  } else if (sendNow) {
    await api('POST', `/emailCampaigns/${campaign.id}/sendNow`);
    console.log('Campaign is sending now. Track opens/clicks in the Brevo dashboard.');
  } else if (scheduleAt) {
    console.log(`Campaign scheduled for ${scheduleAt}.`);
  } else {
    console.log('Created as a draft — preview and hit send at https://app.brevo.com (Campaigns).');
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
