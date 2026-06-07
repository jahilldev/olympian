#!/usr/bin/env bash
# Installs the `olympian` systemd service for the current user.
# Run as your regular user; the script uses sudo only to write to /etc/systemd/system/.
set -euo pipefail

SERVICE_NAME="olympian"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_USER="${USER}"
NPM="$(command -v npm)"
NODE_BIN_DIR="$(dirname "$(command -v node)")"

echo "Installing ${SERVICE_NAME} systemd service..."
echo "  User:             ${SERVICE_USER}"
echo "  WorkingDirectory: ${REPO_ROOT}"
echo "  Node:             ${NODE_BIN_DIR}/node"
echo "  NPM:              ${NPM}"
echo ""

sudo install -m 644 /dev/stdin "${SERVICE_FILE}" <<EOF
[Unit]
Description=Olympian Agent
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${REPO_ROOT}

Environment="PATH=${NODE_BIN_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

ExecStartPre=${NPM} ci
ExecStartPre=${NPM} run setup
ExecStartPre=${NPM} run build

ExecStart=/usr/bin/env NODE_ENV=production ${NPM} start

Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"

echo "Done. Service installed at ${SERVICE_FILE}"
echo ""
echo "Commands:"
echo "  sudo systemctl start ${SERVICE_NAME}    # start now"
echo "  sudo systemctl status ${SERVICE_NAME}   # check status"
echo "  sudo journalctl -u ${SERVICE_NAME} -f   # follow logs"
