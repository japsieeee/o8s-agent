#!/usr/bin/env bash
set -e

SERVICE_NAME="o8s-agent"

# Hidden agent directory
AGENT_DIR="/usr/lib/.$SERVICE_NAME"

mkdir -p "$AGENT_DIR"

# Copy binary if it exists in package
if [ ! -f "$AGENT_DIR/$SERVICE_NAME" ]; then
    echo "❌ Error: Binary missing in package!"
    exit 1
fi

# Make binary executable
chmod +x "$AGENT_DIR/$SERVICE_NAME"

# Create launcher in /usr/bin
LAUNCHER="/usr/bin/$SERVICE_NAME"
install -Dm755 "$AGENT_DIR/$SERVICE_NAME" "$LAUNCHER"

echo "✅ Launcher created at $LAUNCHER"
