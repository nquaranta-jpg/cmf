#!/bin/bash
LABEL="com.cmf.imessagewatcher"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Stopped and removed. Your analyses are still in ./data."
