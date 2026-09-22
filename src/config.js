const dotenv = require('dotenv');

dotenv.config();

function getConfig() {
  return {
    meetingId: process.env.ZOOM_MEETING_ID || '',
    passcode: process.env.ZOOM_PASSCODE || '',
    attendeeName: process.env.ATTENDEE_NAME || 'Attendee',
    attendeeEmail: process.env.ATTENDEE_EMAIL || '',
    webinarToken: process.env.ZOOM_WEBINAR_TOKEN || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    maxDurationMinutes: Number(process.env.MAX_DURATION_MINUTES) || 180,
    heartbeatIntervalMinutes: Number(process.env.HEARTBEAT_INTERVAL_MINUTES) || 30,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
    screenshotsDir: process.env.SCREENSHOTS_DIR || './screenshots'
  };
}

module.exports = {
  getConfig
};
