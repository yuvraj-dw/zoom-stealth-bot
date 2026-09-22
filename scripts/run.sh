#!/usr/bin/env bash
set -e

# Determine directory of this script and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

LOG_FILE="${PROJECT_DIR}/bot.log"

echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Starting Zoom Attendee Bot run..." | tee -a "${LOG_FILE}"

# Execute docker compose run and log output with timestamp
docker compose run --rm zoom-bot 2>&1 | tee -a "${LOG_FILE}"
EXIT_STATUS=${PIPESTATUS[0]}

echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Zoom Attendee Bot finished with exit code ${EXIT_STATUS}" | tee -a "${LOG_FILE}"

exit ${EXIT_STATUS}
