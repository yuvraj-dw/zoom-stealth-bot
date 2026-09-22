#!/usr/bin/env bash
set -e

# Determine directory of this script and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

# Ensure screenshots directory exists
mkdir -p "${PROJECT_DIR}/screenshots"

echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Starting Zoom Attendee Bot daemon in background..."
docker compose up -d --build

echo "[OK] Zoom Attendee Bot daemon started."
echo "Use 'bash scripts/logs.sh' to view live logs."
echo "Use 'bash scripts/stop.sh' to stop the daemon."
