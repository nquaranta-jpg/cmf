#!/usr/bin/env bash
# Builds the ChatGPT plugin ZIP from chatgpt-plugin/ (manifest, MCP config, skill, icons; never SUBMISSION.md).
set -euo pipefail
cd "$(dirname "$0")/../chatgpt-plugin"
out="../crown-merchant-financial-chatgpt.zip"
rm -f "$out"
zip -qr "$out" plugin.json mcp.json skills assets
echo "Built $(cd .. && pwd)/crown-merchant-financial-chatgpt.zip"
