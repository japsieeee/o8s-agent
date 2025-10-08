#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="o8s-agent"

CONFIG_DIR="/etc/$SERVICE_NAME"
CONFIG_FILE="$CONFIG_DIR/config.yml"
PM2_DIR="$CONFIG_DIR/pm2"
PM2_ECOSYSTEM_CONFIG_FILE="$PM2_DIR/ecosystem.config.js"
PM2_SCRIPTS_ROOT_DIR="$PM2_DIR/scripts"

# Require root for setup
if [ "$EUID" -ne 0 ]; then
  echo "❌ Please run as root (sudo $0)"
  exit 1
fi

# Create directories with global read+execute
mkdir -p "$CONFIG_DIR"
mkdir -p "$PM2_DIR"
mkdir -p "$PM2_SCRIPTS_ROOT_DIR"

chmod 755 "$CONFIG_DIR"
chmod 755 "$PM2_DIR"
chmod 755 "$PM2_SCRIPTS_ROOT_DIR"

# Create config.yml (publicly readable and editable)
if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" <<EOF
clusterId:
agentId:
interval: 30
pm2EcosystemPath: $PM2_ECOSYSTEM_CONFIG_FILE
pm2ScriptsRootDir: $PM2_SCRIPTS_ROOT_DIR
EOF
  chmod 666 "$CONFIG_FILE"
  echo "✅ Default config created at $CONFIG_FILE (public writable)"
else
  echo "ℹ️ Config already exists at $CONFIG_FILE"
  chmod 666 "$CONFIG_FILE"
fi

# Create ecosystem.config.js (publicly readable and editable)
if [ ! -f "$PM2_ECOSYSTEM_CONFIG_FILE" ]; then
  cat > "$PM2_ECOSYSTEM_CONFIG_FILE" <<'EOF'
// Default PM2 Ecosystem Config
EOF
  chmod 666 "$PM2_ECOSYSTEM_CONFIG_FILE"
  echo "✅ Default PM2 ecosystem created at $PM2_ECOSYSTEM_CONFIG_FILE (public writable)"
else
  echo "ℹ️ PM2 ecosystem already exists at $PM2_ECOSYSTEM_CONFIG_FILE"
  chmod 666 "$PM2_ECOSYSTEM_CONFIG_FILE"
fi

# Reload systemd and start service
if systemctl list-unit-files | grep -q "^$SERVICE_NAME.service"; then
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME" || true
  echo "🚀 $SERVICE_NAME installed and started"
else
  echo "⚠️ $SERVICE_NAME systemd unit not found. Skipping service start."
fi
