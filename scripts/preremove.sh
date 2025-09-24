#!/usr/bin/env bash
set -e

SERVICE_NAME="o8s-agent"

# Stop service
systemctl stop $SERVICE_NAME || true
systemctl disable $SERVICE_NAME || true
