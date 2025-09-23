#!/bin/bash
set -e

ROOT_DIR="/etc/jp-monitoring-agent"
BACKEND_URL="ws://localhost:26312"
SERVICE_NAME="jp-monitoring-agent"

echo "🧹 Cleaning up JP Monitoring Agent completely..."

# Stop and disable systemd service if exists
if systemctl list-units --full -all | grep -q jp-monitoring-agent.service; then
  echo "⏹ Stopping and disabling systemd service..."
  sudo systemctl stop jp-monitoring-agent || true
  sudo systemctl disable jp-monitoring-agent || true
  sudo systemctl daemon-reload
fi

# Remove systemd service file
SERVICE_FILE="/lib/systemd/system/jp-monitoring-agent.service"
if [ -f "$SERVICE_FILE" ]; then
  echo "🗑 Removing systemd service file..."
  sudo rm -f "$SERVICE_FILE"
fi

# Remove launcher in /usr/bin
if [ -f "/usr/bin/jp-monitoring-agent" ]; then
  echo "🗑 Removing launcher..."
  sudo rm -f /usr/bin/jp-monitoring-agent
fi

# Remove hidden agent folder
HIDDEN_DIR="/usr/lib/.jp-monitoring-agent"
if [ -d "$HIDDEN_DIR" ]; then
  echo "🗑 Removing hidden agent directory..."
  sudo rm -rf "$HIDDEN_DIR"
fi

# Remove config directory
CONFIG_DIR="/etc/jp-monitoring-agent"
if [ -d "$CONFIG_DIR" ]; then
  echo "🗑 Removing config directory..."
  sudo rm -rf "$CONFIG_DIR"
fi

# Remove docs/license
DOC_FILE="/usr/share/doc/jp-monitoring-agent/LICENSE"
if [ -f "$DOC_FILE" ]; then
  echo "🗑 Removing documentation..."
  sudo rm -f "$DOC_FILE"
fi

# Remove broken dpkg info files to prevent postrm/prerm errors
DPKG_INFO="/var/lib/dpkg/info/jp-monitoring-agent.*"
if ls $DPKG_INFO 1> /dev/null 2>&1; then
  echo "🗑 Removing broken dpkg script files..."
  sudo rm -f $DPKG_INFO
fi

# Remove package from dpkg database forcibly
if dpkg -l | grep -q jp-monitoring-agent; then
  echo "🗑 Forcibly removing package from dpkg database..."
  sudo dpkg --remove --force-remove-reinstreq jp-monitoring-agent || true
  sudo dpkg --purge --force-all jp-monitoring-agent || true
fi

echo "✅ JP Monitoring Agent cleanup completed."
