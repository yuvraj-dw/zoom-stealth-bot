#!/usr/bin/env bash
set -e

# Determine directory of this script and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

echo "============================================="
echo "  Setting up Zoom Attendee Bot Cron Schedule "
echo "============================================="

# 1. Ensure .env exists
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    echo "[!] .env file not found. Creating from .env.example..."
    cp .env.example .env
    echo "[!] Created .env. Please update it with your Telegram credentials and Zoom settings if needed."
  else
    echo "[!] Creating default .env file..."
    cat << 'EOF' > .env
ZOOM_MEETING_ID=1234567890
ZOOM_PASSCODE=secret123
ATTENDEE_NAME="Attendee"
ATTENDEE_EMAIL=attendee@example.com
MAX_DURATION_MINUTES=180
HEARTBEAT_INTERVAL_MINUTES=30
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
SCREENSHOTS_DIR=./screenshots
EOF
  fi
else
  echo "[OK] .env file exists."
fi

# 2. Create screenshots directory
mkdir -p "${PROJECT_DIR}/screenshots"
echo "[OK] Screenshots directory ensured at ${PROJECT_DIR}/screenshots"

# 3. Make run.sh executable
chmod +x "${PROJECT_DIR}/scripts/run.sh"
echo "[OK] Marked scripts/run.sh as executable."

# 4. Build Docker image
echo "[*] Building Docker container image..."
docker compose build zoom-bot
echo "[OK] Docker image built successfully."

# 5. Install crontab entry for Monday to Saturday at 18:55 IST (13:25 UTC)
# Monday-Saturday: 1-6
# 18:55 IST = 13:25 UTC
RUN_SCRIPT="${PROJECT_DIR}/scripts/run.sh"
LOG_FILE="${PROJECT_DIR}/bot.log"
CRON_TAG="# ZOOM_ATTENDEE_BOT"

# Detect server timezone
TZ_OFFSET=$(date +%z 2>/dev/null || echo "+0000")
if [ "$TZ_OFFSET" = "+0530" ]; then
  CRON_TIME="55 18 * * 1-6"
  TIME_DESC="18:55 IST (system local time)"
else
  CRON_TIME="25 13 * * 1-6"
  TIME_DESC="13:25 UTC (corresponds to 18:55 IST)"
fi

CRON_CMD="${CRON_TIME} ${RUN_SCRIPT} >> ${LOG_FILE} 2>&1 ${CRON_TAG}"

# Read existing crontab without the zoom bot tag
CURRENT_CRON=$(crontab -l 2>/dev/null | grep -v "${CRON_TAG}" || true)

# Append new crontab entry
if [ -n "${CURRENT_CRON}" ]; then
  NEW_CRON="${CURRENT_CRON}
${CRON_CMD}"
else
  NEW_CRON="${CRON_CMD}"
fi

echo "${NEW_CRON}" | crontab -

echo "[OK] Installed crontab entry (${TIME_DESC}):"
echo "    ${CRON_CMD}"
echo ""
echo "Setup complete! The bot is scheduled to run Mon-Sat at 18:55 IST."
