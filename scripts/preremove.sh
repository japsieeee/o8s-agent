#!/usr/bin/env bash
set -e

# Stop service
systemctl stop jp-monitoring-agent || true
systemctl disable jp-monitoring-agent || true
