#!/usr/bin/env sh
set -eu

NAME="${OMNI_AGENT_SERVICE_NAME:-ai.omni-agent.gateway}"
CWD="${OMNI_AGENT_CWD:-$(pwd)}"
STORAGE_ROOT="${OMNI_AGENT_STORAGE_ROOT:-$HOME/.omni-agent}"
PORT="${OMNI_AGENT_PORT:-4040}"
REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$NAME.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$NAME</string>
  <key>WorkingDirectory</key><string>$REPO_ROOT</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(command -v node)</string>
    <string>$REPO_ROOT/dist/omni-agent.js</string>
    <string>serve</string>
    <string>--cwd</string><string>$CWD</string>
    <string>--storage-root</string><string>$STORAGE_ROOT</string>
    <string>--port</string><string>$PORT</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
EOF
launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST"
echo "Installed and started $NAME"
