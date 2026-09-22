#!/usr/bin/env bash
set -e

# Determine directory of this script and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

echo "[*] Tailing live logs from zoom-attendee-bot container (Ctrl+C to exit)..."
docker compose logs -f
