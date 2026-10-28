# iMessage Watcher

Watches your Mac's Messages database and has Claude analyze each conversation as texts come in. For every inbound burst it records:

- **category**: prospect, client, recruit, carrier/upline, vendor, personal, school, spam
- **urgency** 1-5, **sentiment**, **intent**, one-line **summary**
- **next action** and a **ready-to-send reply** in your voice
- **buying signals**, **risk flags** (cancel, failed payment, complaint), **follow-up date**

Results go to `data/analysis.db` (SQLite), `data/analysis.jsonl`, a macOS notification when action is needed, and optionally a webhook.

Requirements: a Mac signed into iMessage (with Text Message Forwarding on if you want SMS too), Python 3.9+, an Anthropic API key. No pip installs.

## Setup (5 minutes)

```bash
cd imessage-watcher
cp .env.example .env          # paste your ANTHROPIC_API_KEY
chmod +x install.sh uninstall.sh
```

**Test in Terminal first.** Give Terminal Full Disk Access (System Settings > Privacy & Security > Full Disk Access > add Terminal), reopen Terminal, then:

```bash
python3 imessage_watcher.py --recent 6     # analyze the last 6 hours, then exit
python3 imessage_watcher.py --report       # see today's results
python3 imessage_watcher.py                # live mode; text yourself from another number to test
```

**Run it in the background** (starts at login, restarts on crash):

```bash
./install.sh
```

It prints the exact Python path to add to Full Disk Access. Add it, then run the `launchctl kickstart` line it prints.

Logs: `tail -f data/watcher.log`. Remove: `./uninstall.sh`.

## Tuning

- **What Claude looks for** lives in `prompt.md`. Edit categories, urgency rules, and reply style there. Changes apply on the next message, no restart needed.
- **`.env`** controls model, quiet window (default 20s so a burst of texts is analyzed once), context length, notification threshold, group chats, ignored numbers.
- Notifications are suppressed if you already replied in that thread.

## Send results to a Google Sheet

1. New Google Sheet > Extensions > Apps Script, paste:

```javascript
function doPost(e) {
  const r = JSON.parse(e.postData.contents);
  const a = r.analysis;
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sh.getLastRow() === 0) {
    sh.appendRow(["Analyzed", "Contact", "Handle", "Category", "Urgency", "Action",
                  "Summary", "Next action", "Suggested reply", "Follow up by", "Risk flags", "Messages"]);
  }
  sh.appendRow([r.analyzed_at, r.contact, r.handle, a.category, a.urgency, a.action_needed,
                a.summary, a.next_action, a.suggested_reply, a.follow_up_by || "",
                (a.risk_flags || []).join("; "), r.new_messages]);
  return ContentService.createTextOutput("ok");
}
```

2. Deploy > New deployment > Web app, execute as **Me**, access **Anyone**. Copy the URL into `WEBHOOK_URL` in `.env`.

## Querying history

```bash
sqlite3 data/analysis.db "SELECT contact, urgency, summary FROM analyses WHERE category='prospect' ORDER BY id DESC LIMIT 20;"
```

## Privacy

The database is opened read-only; nothing is ever sent or modified in Messages. The text of analyzed conversations (new messages plus up to 20 earlier ones) is sent to the Anthropic API. Group chats are skipped by default. Add any numbers you never want analyzed to `IGNORE_HANDLES`.
