const test = require('node:test');
const assert = require('node:assert/strict');
const { getConfig } = require('../src/config.js');

test('getConfig returns default fallback values when env vars are empty', () => {
  const envBackup = { ...process.env };
  
  delete process.env.ZOOM_MEETING_ID;
  delete process.env.ZOOM_PASSCODE;
  delete process.env.ATTENDEE_NAME;
  delete process.env.ATTENDEE_EMAIL;
  delete process.env.MAX_DURATION_MINUTES;
  delete process.env.HEARTBEAT_INTERVAL_MINUTES;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.SCREENSHOTS_DIR;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;

  const config = getConfig();

  assert.equal(config.meetingId, '');
  assert.equal(config.passcode, '');
  assert.equal(config.attendeeName, 'Attendee');
  assert.equal(config.attendeeEmail, '');
  assert.equal(config.webinarToken, '');
  assert.equal(config.geminiApiKey, '');
  assert.equal(config.geminiModel, 'gemini-3.5-flash');
  assert.equal(config.maxDurationMinutes, 180);
  assert.equal(config.heartbeatIntervalMinutes, 30);
  assert.equal(config.telegramBotToken, '');
  assert.equal(config.telegramChatId, '');
  assert.equal(config.screenshotsDir, './screenshots');

  // restore env
  process.env = envBackup;
});

test('getConfig parses custom environment variables correctly', () => {
  const envBackup = { ...process.env };

  process.env.ZOOM_MEETING_ID = '1234567890';
  process.env.ZOOM_PASSCODE = 'abcdef';
  process.env.ATTENDEE_NAME = 'Test User';
  process.env.ATTENDEE_EMAIL = 'test@example.com';
  process.env.MAX_DURATION_MINUTES = '60';
  process.env.HEARTBEAT_INTERVAL_MINUTES = '15';
  process.env.TELEGRAM_BOT_TOKEN = 'token123';
  process.env.TELEGRAM_CHAT_ID = 'chat456';
  process.env.SCREENSHOTS_DIR = '/custom/screenshots';

  const config = getConfig();

  assert.equal(config.meetingId, '1234567890');
  assert.equal(config.passcode, 'abcdef');
  assert.equal(config.attendeeName, 'Test User');
  assert.equal(config.attendeeEmail, 'test@example.com');
  assert.equal(config.maxDurationMinutes, 60);
  assert.equal(config.heartbeatIntervalMinutes, 15);
  assert.equal(config.telegramBotToken, 'token123');
  assert.equal(config.telegramChatId, 'chat456');
  assert.equal(config.screenshotsDir, '/custom/screenshots');

  // restore env
  process.env = envBackup;
});
