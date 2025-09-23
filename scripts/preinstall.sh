#!/usr/bin/env bash
set -e

# Hidden agent directory
AGENT_DIR="/usr/lib/.jp-monitoring-agent"

mkdir -p "$AGENT_DIR"

# Copy binary if it exists in package
if [ ! -f "$AGENT_DIR/jp-monitoring-agent" ]; then
    echo "❌ Error: Binary missing in package!"
    exit 1
fi

# Make binary executable
chmod +x "$AGENT_DIR/jp-monitoring-agent"

# Create launcher in /usr/bin
LAUNCHER="/usr/bin/jp-monitoring-agent"
install -Dm755 "$AGENT_DIR/jp-monitoring-agent" "$LAUNCHER"

echo "✅ Launcher created at $LAUNCHER"
