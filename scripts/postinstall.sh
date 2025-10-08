#!/usr/bin/env bash
set -e

SERVICE_NAME="o8s-agent"

# Ensure default config exists
CONFIG_FILE="/etc/$SERVICE_NAME/config.yml"
PM2_ECOSYSTEM_CONFIG_FILE="/etc/$SERVICE_NAME/pm2/ecosystem.config.js"
PM2_SCRIPTS_ROOT_DIR="/etc/$SERVICE_NAME/pm2/scripts"

mkdir -p "$(dirname "$CONFIG_FILE")"
mkdir -p "$(dirname "$PM2_ECOSYSTEM_CONFIG_FILE")"

if [ ! -f "$CONFIG_FILE" ]; then
    cat <<EOF > "$CONFIG_FILE"
clusterId: 
agentId: 
interval: 30
pm2EcosystemPath: $PM2_ECOSYSTEM_CONFIG_FILE
pm2ScriptsRootDir: $PM2_SCRIPTS_ROOT_DIR
EOF
    echo "✅ Default config created at $CONFIG_FILE"
fi

if [ ! -f "$PM2_ECOSYSTEM_CONFIG_FILE" ]; then
    cat <<EOF > "$PM2_ECOSYSTEM_CONFIG_FILE"
# edit your ecosystem of pm2 config here
EOF
    echo "✅ Default pm2 ecosystem created at $PM2_ECOSYSTEM_CONFIG_FILE"
fi

# Reload systemd and start service
systemctl daemon-reload
systemctl enable $SERVICE_NAME
systemctl restart $SERVICE_NAME || true
echo "🚀 $SERVICE_NAME installed and started"
