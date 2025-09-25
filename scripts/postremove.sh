#!/usr/bin/env bash
set -e

SERVICE_NAME="o8s-agent"

# Remove launcher
rm -f /usr/bin/$SERVICE_NAME

# Remove hidden agent folder
rm -rf /usr/lib/.$SERVICE_NAME

# Optionally remove config
# rm -rf /etc/$SERVICE_NAME