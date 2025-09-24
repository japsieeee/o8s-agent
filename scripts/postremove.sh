#!/usr/bin/env bash
set -e

SERVICE_NAME="o8s-agent"

# Remove launcher
rm -f /usr/bin/$SERVICE_NAME

# Remove hidden agent folder
rm -rf /usr/lib/.$SERVICE_NAME

# Optionally remove config
# rm -rf /etc/$SERVICE_NAME

SERVICE_NAME="o8s-agent"

echo "🧹 Cleaning up o8s agent completely..."

# Stop and disable systemd service if exists
if systemctl list-units --full -all | grep -q $SERVICE_NAME.service; then
  echo "⏹ Stopping and disabling systemd service..."
  sudo systemctl stop $SERVICE_NAME || true
  sudo systemctl disable $SERVICE_NAME || true
  sudo systemctl daemon-reload
fi

# Remove systemd service file
SERVICE_FILE="/lib/systemd/system/$SERVICE_NAME.service"
if [ -f "$SERVICE_FILE" ]; then
  echo "🗑 Removing systemd service file..."
  sudo rm -f "$SERVICE_FILE"
fi

# Remove launcher in /usr/bin
if [ -f "/usr/bin/$SERVICE_NAME" ]; then
  echo "🗑 Removing launcher..."
  sudo rm -f /usr/bin/$SERVICE_NAME
fi

# Remove hidden agent folder
HIDDEN_DIR="/usr/lib/.$SERVICE_NAME"
if [ -d "$HIDDEN_DIR" ]; then
  echo "🗑 Removing hidden agent directory..."
  sudo rm -rf "$HIDDEN_DIR"
fi

# Remove config directory
CONFIG_DIR="/etc/$SERVICE_NAME"
if [ -d "$CONFIG_DIR" ]; then
  echo "🗑 Removing config directory..."
  sudo rm -rf "$CONFIG_DIR"
fi

# Remove docs/license
DOC_FILE="/usr/share/doc/$SERVICE_NAME/LICENSE"
if [ -f "$DOC_FILE" ]; then
  echo "🗑 Removing documentation..."
  sudo rm -f "$DOC_FILE"
fi

# Remove broken dpkg info files to prevent postrm/prerm errors
DPKG_INFO="/var/lib/dpkg/info/$SERVICE_NAME.*"
if ls $DPKG_INFO 1> /dev/null 2>&1; then
  echo "🗑 Removing broken dpkg script files..."
  sudo rm -f $DPKG_INFO
fi

# Remove package from dpkg database forcibly
if dpkg -l | grep -q $SERVICE_NAME; then
  echo "🗑 Forcibly removing package from dpkg database..."
  sudo dpkg --remove --force-remove-reinstreq $SERVICE_NAME || true
  sudo dpkg --purge --force-all $SERVICE_NAME || true
fi

echo "✅ o8s agent cleanup completed."
