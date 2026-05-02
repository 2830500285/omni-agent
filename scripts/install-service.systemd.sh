#!/usr/bin/env sh
set -eu

NAME="${OMNI_AGENT_SERVICE_NAME:-omni-agent-gateway}"
CWD="${OMNI_AGENT_CWD:-$(pwd)}"
STORAGE_ROOT="${OMNI_AGENT_STORAGE_ROOT:-$HOME/.omni-agent}"
PORT="${OMNI_AGENT_PORT:-4040}"
REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/$NAME.service" <<EOF
[Unit]
Description=Omni Agent Gateway

[Service]
WorkingDirectory=$REPO_ROOT
ExecStart=$(command -v node) $REPO_ROOT/dist/omni-agent.js serve --cwd "$CWD" --storage-root "$STORAGE_ROOT" --port "$PORT"
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now "$NAME.service"
echo "Installed and started $NAME.service"
