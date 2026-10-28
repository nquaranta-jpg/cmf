#!/usr/bin/env python3
"""
iMessage Watcher
----------------
Analyzes incoming iMessages / SMS on macOS with Claude as they arrive.

How it works
  1. Polls ~/Library/Messages/chat.db (opened read-only) for new rows.
  2. Waits until a conversation goes quiet (QUIET_SECONDS) so a burst of
     texts is analyzed once, not five times.
  3. Sends the new messages plus recent context to Claude, which returns
     structured JSON: category, intent, urgency, next action, suggested reply.
  4. Logs every result to data/analysis.db + data/analysis.jsonl, fires a
     macOS notification when action is needed, and optionally POSTs to a
     webhook (Google Sheet via Apps Script, Slack, Zapier, etc.).

No third-party packages. Requires Python 3.9+ and Full Disk Access.

Usage
  python3 imessage_watcher.py              run the watcher (Ctrl+C to stop)
  python3 imessage_watcher.py --recent 6   analyze conversations from the last 6 hours, then exit
  python3 imessage_watcher.py --report     print today's analyses
"""
import argparse
import glob
import json
import logging
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HOME = Path.home()
BASE_DIR = Path(__file__).resolve().parent


# ---------------------------------------------------------------- config ---
def load_env(path: Path):
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env(BASE_DIR / ".env")


def env_bool(name, default=False):
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL = os.environ.get("MODEL", "claude-haiku-5-5")
CHAT_DB = Path(os.environ.get("CHAT_DB", str(HOME / "Library/Messages/chat.db"))).expanduser()
DATA_DIR = Path(os.environ.get("DATA_DIR", str(BASE_DIR / "data"))).expanduser()
PROMPT_FILE = Path(os.environ.get("PROMPT_FILE", str(BASE_DIR / "prompt.md"))).expanduser()
POLL_SECONDS = float(os.environ.get("POLL_SECONDS", "2"))
QUIET_SECONDS = float(os.environ.get("QUIET_SECONDS", "20"))
CONTEXT_MESSAGES = int(os.environ.get("CONTEXT_MESSAGES", "20"))
INCLUDE_GROUPS = env_bool("INCLUDE_GROUPS", False)
NOTIFY = env_bool("NOTIFY", True)
NOTIFY_MIN_URGENCY = int(os.environ.get("NOTIFY_MIN_URGENCY", "4"))
WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "").strip()
DRY_RUN = env_bool("DRY_RUN", False)
IGNORE_HANDLES = {h.strip() for h in os.environ.get("IGNORE_HANDLES", "").split(",") if h.strip()}
IGNORE_CATEGORIES_FOR_NOTIFY = {c.strip() for c in os.environ.get("QUIET_CATEGORIES", "spam").split(",") if c.strip()}

DATA_DIR.mkdir(parents=True, exist_ok=True)
STATE_FILE = DATA_DIR / "state.json"
OUT_DB = DATA_DIR / "analysis.db"
OUT_JSONL = DATA_DIR / "analysis.jsonl"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("imessage-watcher")


# --------------------------------------------------------------- helpers ---
def norm_handle(h: str) -> str:
    if not h:
        return ""
    if "@" in h:
        return h.strip().lower()
    digits = re.sub(r"\D", "", h)
    return digits[-10:] if len(digits) >= 10 else digits


IGNORE_NORM = {norm_handle(h) for h in IGNORE_HANDLES}


def apple_time(v):
    """chat.db dates are seconds (old) or nanoseconds (new) since 2001-01-01 UTC."""
    if not v:
        return None
    secs = v / 1e9 if v > 1e11 else v
    return datetime(2001, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=secs)


def to_apple_ns(dt: datetime) -> int:
    return int((dt - datetime(2001, 1, 1, tzinfo=timezone.utc)).total_seconds() * 1e9)


def decode_attributed_body(blob):
    """Newer macOS stores message text only in attributedBody (an NSAttributedString typedstream)."""
    if not blob:
        return None
    try:
        i = blob.find(b"NSString")
        if i < 0:
            return None
        j = blob.find(b"\x2b", i + 8)  # '+' marks the start of the string payload
        if j < 0:
            return None
        k = j + 1
        n = blob[k]
        k += 1
        if n == 0x81:
            n = int.from_bytes(blob[k:k + 2], "little")
            k += 2
        elif n == 0x82:
            n = int.from_bytes(blob[k:k + 4], "little")
            k += 4
        return blob[k:k + n].decode("utf-8", errors="replace")
    except Exception:
        return None


def message_text(row) -> str:
    t = row["text"] or decode_attributed_body(row["attributedBody"]) or ""
    t = t.replace("\ufffc", "").strip()  # object-replacement char = inline attachment
    if row["cache_has_attachments"]:
        t = (t + " [attachment]").strip()
    return t


# -------------------------------------------------------------- contacts ---
class Contacts:
    def __init__(self):
        self.names = {}
        self.loaded_at = 0.0

    def refresh(self, force=False):
        if not force and time.time() - self.loaded_at < 600:
            return
        names = {}
        roots = glob.glob(str(HOME / "Library/Application Support/AddressBook/Sources/*/AddressBook-v22.abcddb"))
        roots.append(str(HOME / "Library/Application Support/AddressBook/AddressBook-v22.abcddb"))
        for db in roots:
            if not os.path.exists(db):
                continue
            try:
                con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
                rows = con.execute(
                    "SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, p.ZFULLNUMBER "
                    "FROM ZABCDRECORD r JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK"
                ).fetchall()
                rows += con.execute(
                    "SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, e.ZADDRESS "
                    "FROM ZABCDRECORD r JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK"
                ).fetchall()
                con.close()
            except sqlite3.Error:
                continue
            for first, last, org, value in rows:
                name = " ".join(x for x in (first, last) if x) or org
                if name and value:
                    names[norm_handle(value)] = name
        self.names = names
        self.loaded_at = time.time()
        log.info("Loaded %d contact handles", len(names))

    def name(self, handle: str) -> str:
        return self.names.get(norm_handle(handle), "")


CONTACTS = Contacts()


# -------------------------------------------------------------- chat.db ----
def open_chat_db():
    try:
        con = sqlite3.connect(f"file:{CHAT_DB}?mode=ro", uri=True, timeout=5)
        con.row_factory = sqlite3.Row
        con.execute("SELECT 1 FROM message LIMIT 1")
        return con
    except sqlite3.Error as e:
        log.error(
            "Cannot read %s (%s).\n"
            "Grant Full Disk Access: System Settings > Privacy & Security > Full Disk Access,\n"
            "then add the app running this script (Terminal, iTerm, or the python3 binary for launchd).",
            CHAT_DB, e,
        )
        sys.exit(1)


BASE_SELECT = """
SELECT m.ROWID AS rowid, m.guid, m.text, m.attributedBody, m.is_from_me, m.date,
       m.cache_has_attachments, COALESCE(m.associated_message_type, 0) AS assoc_type,
       COALESCE(h.id, '') AS handle, c.ROWID AS chat_id, c.chat_identifier, c.display_name,
       (SELECT COUNT(DISTINCT chj.handle_id) FROM chat_handle_join chj WHERE chj.chat_id = c.ROWID) AS members
FROM message m
LEFT JOIN handle h ON h.ROWID = m.handle_id
LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
LEFT JOIN chat c ON c.ROWID = cmj.chat_id
"""


def max_rowid(con) -> int:
    return con.execute("SELECT COALESCE(MAX(ROWID), 0) FROM message").fetchone()[0]


def fetch_new(con, after_rowid: int):
    return con.execute(BASE_SELECT + " WHERE m.ROWID > ? ORDER BY m.ROWID", (after_rowid,)).fetchall()


def fetch_context(con, chat_id: int, through_rowid: int, limit: int):
    rows = con.execute(
        BASE_SELECT + " WHERE cmj.chat_id = ? AND m.ROWID <= ? AND COALESCE(m.associated_message_type,0) = 0"
        " ORDER BY m.ROWID DESC LIMIT ?",
        (chat_id, through_rowid, limit),
    ).fetchall()
    return list(reversed(rows))


# ----------------------------------------------------------------- state ---
def load_state():
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except json.JSONDecodeError:
            pass
    return {"last_rowid": None, "pending": {}}


def save_state(state):
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state))
    tmp.replace(STATE_FILE)


# ---------------------------------------------------------------- claude ---
ANALYSIS_TOOL = {
    "name": "record_analysis",
    "description": "Record the analysis of this text conversation.",
    "input_schema": {
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "enum": ["prospect", "client", "recruit", "carrier_or_upline", "vendor",
                         "personal", "school", "spam", "other"],
            },
            "summary": {"type": "string", "description": "One sentence: what the new messages say."},
            "intent": {"type": "string", "description": "What the sender wants, in a few words."},
            "urgency": {"type": "integer", "minimum": 1, "maximum": 5,
                        "description": "1 = no action ever, 5 = respond within minutes."},
            "sentiment": {"type": "string", "enum": ["positive", "neutral", "negative"]},
            "action_needed": {"type": "boolean"},
            "next_action": {"type": "string", "description": "The single concrete next step for Nick, or empty."},
            "buying_signals": {"type": "array", "items": {"type": "string"}},
            "risk_flags": {"type": "array", "items": {"type": "string"},
                           "description": "e.g. wants to cancel, payment failed, complaint, compliance concern."},
            "follow_up_by": {"type": "string", "description": "YYYY-MM-DD if a follow-up date is implied, else empty."},
            "suggested_reply": {"type": "string", "description": "Ready-to-send text reply in Nick's voice, or empty."},
        },
        "required": ["category", "summary", "intent", "urgency", "sentiment",
                     "action_needed", "next_action", "suggested_reply"],
    },
}


def load_system_prompt():
    if PROMPT_FILE.exists():
        return PROMPT_FILE.read_text()
    return "You analyze incoming text messages for a busy business owner."


def call_claude(transcript: str, meta: dict) -> dict:
    if DRY_RUN:
        return {
            "category": "other", "summary": "(dry run) " + transcript.splitlines()[-1][:120],
            "intent": "dry run", "urgency": 4, "sentiment": "neutral", "action_needed": True,
            "next_action": "(dry run)", "buying_signals": [], "risk_flags": [],
            "follow_up_by": "", "suggested_reply": "(dry run)",
        }
    if not API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY is not set (put it in .env)")

    now_local = datetime.now().astimezone().strftime("%A %Y-%m-%d %H:%M %Z")
    user_msg = (
        f"Current time: {now_local}\n"
        f"Contact: {meta['contact'] or 'not in contacts'} ({meta['handle']})\n"
        f"Group chat: {'yes, ' + str(meta['members']) + ' members' if meta['is_group'] else 'no'}\n"
        f"Nick already replied after the new messages: {'yes' if meta['replied'] else 'no'}\n\n"
        "Conversation (oldest first). Lines marked >> are NEW and need analysis; the rest is context.\n\n"
        f"{transcript}"
    )
    body = {
        "model": MODEL,
        "max_tokens": 1024,
        "system": load_system_prompt(),
        "tools": [ANALYSIS_TOOL],
        "tool_choice": {"type": "tool", "name": "record_analysis"},
        "messages": [{"role": "user", "content": user_msg}],
    }
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(body).encode(),
        headers={
            "x-api-key": API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                resp = json.loads(r.read())
            for block in resp.get("content", []):
                if block.get("type") == "tool_use":
                    return block["input"]
            raise RuntimeError(f"No tool_use in response: {resp}")
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            if e.code in (429, 500, 502, 503, 529) and attempt < 3:
                time.sleep(2 ** attempt * 2)
                continue
            raise RuntimeError(f"Claude API {e.code}: {detail}")
        except urllib.error.URLError:
            if attempt < 3:
                time.sleep(2 ** attempt * 2)
                continue
            raise


# --------------------------------------------------------------- outputs ---
def init_out_db():
    con = sqlite3.connect(OUT_DB)
    con.execute(
        """CREATE TABLE IF NOT EXISTS analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            analyzed_at TEXT, last_message_at TEXT, chat_id INTEGER, handle TEXT, contact TEXT,
            category TEXT, urgency INTEGER, sentiment TEXT, action_needed INTEGER,
            summary TEXT, intent TEXT, next_action TEXT, suggested_reply TEXT,
            follow_up_by TEXT, buying_signals TEXT, risk_flags TEXT,
            new_messages TEXT, message_rowids TEXT, raw TEXT)"""
    )
    con.commit()
    return con


def notify(title: str, subtitle: str, message: str):
    script = [
        "-e", "on run argv",
        "-e", "display notification (item 3 of argv) with title (item 1 of argv) subtitle (item 2 of argv) sound name \"Glass\"",
        "-e", "end run",
    ]
    try:
        subprocess.run(["osascript", *script, title[:120], subtitle[:200], message[:300]],
                       check=False, capture_output=True, timeout=10)
    except Exception as e:
        log.warning("Notification failed: %s", e)


def post_webhook(record: dict):
    try:
        req = urllib.request.Request(WEBHOOK_URL, data=json.dumps(record).encode(),
                                     headers={"content-type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as e:
        log.warning("Webhook failed: %s", e)


def emit(out_con, record: dict):
    a = record["analysis"]
    out_con.execute(
        """INSERT INTO analyses (analyzed_at, last_message_at, chat_id, handle, contact, category, urgency,
           sentiment, action_needed, summary, intent, next_action, suggested_reply, follow_up_by,
           buying_signals, risk_flags, new_messages, message_rowids, raw)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            record["analyzed_at"], record["last_message_at"], record["chat_id"], record["handle"],
            record["contact"], a.get("category"), a.get("urgency"), a.get("sentiment"),
            int(bool(a.get("action_needed"))), a.get("summary"), a.get("intent"), a.get("next_action"),
            a.get("suggested_reply"), a.get("follow_up_by", ""), json.dumps(a.get("buying_signals", [])),
            json.dumps(a.get("risk_flags", [])), record["new_messages"], json.dumps(record["rowids"]),
            json.dumps(a),
        ),
    )
    out_con.commit()
    with OUT_JSONL.open("a") as f:
        f.write(json.dumps(record) + "\n")

    who = record["contact"] or record["handle"]
    log.info("[%s | urgency %s] %s: %s", a.get("category"), a.get("urgency"), who, a.get("summary"))

    should_notify = (
        NOTIFY
        and not record["replied"]
        and a.get("category") not in IGNORE_CATEGORIES_FOR_NOTIFY
        and (a.get("action_needed") or int(a.get("urgency", 0)) >= NOTIFY_MIN_URGENCY)
        and int(a.get("urgency", 0)) >= min(NOTIFY_MIN_URGENCY, 3)
    )
    if should_notify:
        notify(
            f"{who} · {a.get('category')} · {a.get('urgency')}/5",
            a.get("next_action") or a.get("summary", ""),
            a.get("suggested_reply") or a.get("summary", ""),
        )
    if WEBHOOK_URL:
        post_webhook(record)


# -------------------------------------------------------------- analysis ---
def build_transcript(rows, new_ids: set):
    lines = []
    for r in rows:
        t = message_text(r)
        if not t:
            continue
        ts = apple_time(r["date"])
        stamp = ts.astimezone().strftime("%m-%d %H:%M") if ts else "?"
        if r["is_from_me"]:
            who = "Nick"
        else:
            who = CONTACTS.name(r["handle"]) or r["handle"] or "Them"
        mark = ">> " if r["rowid"] in new_ids else "   "
        lines.append(f"{mark}[{stamp}] {who}: {t}")
    return "\n".join(lines)


def analyze_chat(chat_con, out_con, chat_id: int, new_ids: list):
    new_set = set(new_ids)
    through = max(max_rowid(chat_con), max(new_ids))
    rows = fetch_context(chat_con, chat_id, through, CONTEXT_MESSAGES + len(new_ids))
    inbound_new = [r for r in rows if r["rowid"] in new_set and not r["is_from_me"]]
    if not inbound_new:
        return
    last_in = inbound_new[-1]
    replied = any(r["is_from_me"] and r["rowid"] > last_in["rowid"] for r in rows)
    handle = last_in["handle"]
    meta = {
        "contact": CONTACTS.name(handle) or (last_in["display_name"] or ""),
        "handle": handle or last_in["chat_identifier"] or "",
        "members": last_in["members"] or 1,
        "is_group": (last_in["members"] or 1) > 1,
        "replied": replied,
    }
    transcript = build_transcript(rows, new_set)
    if not transcript.strip():
        return
    analysis = call_claude(transcript, meta)
    ts = apple_time(last_in["date"])
    emit(out_con, {
        "analyzed_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "last_message_at": ts.astimezone().isoformat(timespec="seconds") if ts else "",
        "chat_id": chat_id,
        "handle": meta["handle"],
        "contact": meta["contact"],
        "replied": replied,
        "rowids": sorted(new_set),
        "new_messages": "\n".join(message_text(r) for r in inbound_new),
        "analysis": analysis,
    })


def eligible(row) -> bool:
    if row["chat_id"] is None or row["assoc_type"]:  # skip tapbacks / reactions
        return False
    if (row["members"] or 1) > 1 and not INCLUDE_GROUPS:
        return False
    if norm_handle(row["handle"]) in IGNORE_NORM:
        return False
    return True


# ----------------------------------------------------------------- loops ---
def run_watcher():
    chat_con = open_chat_db()
    out_con = init_out_db()
    CONTACTS.refresh(force=True)
    state = load_state()
    if state.get("last_rowid") is None:
        state["last_rowid"] = max_rowid(chat_con)  # start from now, don't analyze history
        save_state(state)
    log.info("Watching %s from message #%s (model %s%s)", CHAT_DB, state["last_rowid"], MODEL,
             ", DRY RUN" if DRY_RUN else "")

    while True:
        try:
            CONTACTS.refresh()
            rows = fetch_new(chat_con, state["last_rowid"])
            now = time.time()
            for r in rows:
                state["last_rowid"] = max(state["last_rowid"], r["rowid"])
                if not eligible(r):
                    continue
                key = str(r["chat_id"])
                p = state["pending"].setdefault(key, {"ids": [], "last_seen": now})
                p["ids"].append(r["rowid"])
                p["last_seen"] = now
            if rows:
                save_state(state)

            for key in list(state["pending"]):
                p = state["pending"][key]
                if now - p["last_seen"] < QUIET_SECONDS:
                    continue
                try:
                    analyze_chat(chat_con, out_con, int(key), p["ids"])
                except Exception as e:
                    log.error("Analysis failed for chat %s: %s", key, e)
                del state["pending"][key]
                save_state(state)
        except sqlite3.OperationalError as e:
            log.warning("chat.db busy (%s), retrying", e)
            time.sleep(1)
        time.sleep(POLL_SECONDS)


def run_recent(hours: float):
    chat_con = open_chat_db()
    out_con = init_out_db()
    CONTACTS.refresh(force=True)
    since = to_apple_ns(datetime.now(timezone.utc) - timedelta(hours=hours))
    rows = chat_con.execute(BASE_SELECT + " WHERE m.date >= ? ORDER BY m.ROWID", (since,)).fetchall()
    by_chat = {}
    for r in rows:
        if eligible(r):
            by_chat.setdefault(r["chat_id"], []).append(r["rowid"])
    log.info("Analyzing %d conversations from the last %s hours", len(by_chat), hours)
    for chat_id, ids in by_chat.items():
        try:
            analyze_chat(chat_con, out_con, chat_id, ids)
        except Exception as e:
            log.error("Analysis failed for chat %s: %s", chat_id, e)


def run_report():
    if not OUT_DB.exists():
        print("No analyses yet.")
        return
    con = sqlite3.connect(OUT_DB)
    today = datetime.now().astimezone().strftime("%Y-%m-%d")
    rows = con.execute(
        "SELECT analyzed_at, COALESCE(NULLIF(contact,''), handle), category, urgency, action_needed, "
        "summary, next_action FROM analyses WHERE analyzed_at LIKE ? ORDER BY urgency DESC, analyzed_at",
        (today + "%",),
    ).fetchall()
    if not rows:
        print("Nothing analyzed today.")
        return
    for at, who, cat, urg, act, summ, nxt in rows:
        flag = "ACTION" if act else "      "
        print(f"{at[11:16]}  {urg}/5 {flag} {cat:<17} {who}\n        {summ}")
        if nxt:
            print(f"        -> {nxt}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Analyze incoming iMessages with Claude.")
    ap.add_argument("--recent", type=float, metavar="HOURS",
                    help="analyze conversations from the last N hours, then exit")
    ap.add_argument("--report", action="store_true", help="print today's analyses")
    args = ap.parse_args()
    try:
        if args.report:
            run_report()
        elif args.recent:
            run_recent(args.recent)
        else:
            run_watcher()
    except KeyboardInterrupt:
        print("\nStopped.")
