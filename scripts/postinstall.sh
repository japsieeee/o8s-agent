#!/usr/bin/env bash
set -e

SERVICE_NAME="o8s-agent"

# Ensure default config exists
CONFIG_FILE="/etc/$SERVICE_NAME/config.yml"
mkdir -p "$(dirname "$CONFIG_FILE")"

if [ ! -f "$CONFIG_FILE" ]; then
    cat <<EOF > "$CONFIG_FILE"
clusterId:
agentId:
interval: 30
EOF
    echo "✅ Default config created at $CONFIG_FILE"
fi

# Reload systemd and start service
systemctl daemon-reload
systemctl enable $SERVICE_NAME
systemctl restart $SERVICE_NAME || true
echo "🚀 $SERVICE_NAME installed and started"
