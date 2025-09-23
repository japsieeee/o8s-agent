#!/usr/bin/env bash
set -e

# Ensure default config exists
CONFIG_FILE="/etc/jp-monitoring-agent/config.yml"
mkdir -p "$(dirname "$CONFIG_FILE")"

if [ ! -f "$CONFIG_FILE" ]; then
    cat <<EOF > "$CONFIG_FILE"
apiKey: "TEMPORARY_API_KEY"
interval: 15
EOF
    echo "✅ Default config created at $CONFIG_FILE"
fi

# Reload systemd and start service
systemctl daemon-reload
systemctl enable jp-monitoring-agent
systemctl restart jp-monitoring-agent || true
echo "🚀 jp-monitoring-agent installed and started"
