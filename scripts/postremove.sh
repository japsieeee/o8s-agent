#!/usr/bin/env bash
set -e

# Remove launcher
rm -f /usr/bin/jp-monitoring-agent

# Remove hidden agent folder
rm -rf /usr/lib/.jp-monitoring-agent

# Optionally remove config
# rm -rf /etc/jp-monitoring-agent
