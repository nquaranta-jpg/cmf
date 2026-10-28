#!/bin/bash
# Installs the watcher as a background LaunchAgent that starts at login and restarts if it crashes.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.cmf.imessagewatcher"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PY="$(command -v python3)"
PY_REAL="$(python3 -c 'import os,sys; print(os.path.realpath(sys.executable))')"

if [ ! -f "$DIR/.env" ]; then
  cp "$DIR/.env.example" "$DIR/.env"
  echo "Created .env. Add your ANTHROPIC_API_KEY to $DIR/.env, then run ./install.sh again."
  exit 1
fi

mkdir -p "$DIR/data" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY_REAL</string>
    <string>$DIR/imessage_watcher.py</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$DIR/data/watcher.log</string>
  <key>StandardErrorPath</key><string>$DIR/data/watcher.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo ""
echo "Installed and started."
echo ""
echo "ONE-TIME STEP: give this Python Full Disk Access so it can read Messages:"
echo "  System Settings > Privacy & Security > Full Disk Access > +"
echo "  Press Cmd+Shift+G and paste:  $PY_REAL"
echo "Then restart it:  launchctl kickstart -k gui/$(id -u)/$LABEL"
echo ""
echo "Live log:  tail -f \"$DIR/data/watcher.log\""
