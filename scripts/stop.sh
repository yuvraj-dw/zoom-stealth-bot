#!/usr/bin/env bash
set -e

# Determine directory of this script and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Stopping Zoom Attendee Bot daemon..."
docker compose down

echo "[OK] Zoom Attendee Bot daemon stopped."
