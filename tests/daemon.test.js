const test = require('node:test');
const assert = require('node:assert/strict');
const { getISTDateTime, isScheduledTime, createBotDaemon } = require('../src/index.js');

test('getISTDateTime returns valid IST date parts', () => {
  // Use explicit ISO string: 2026-09-21T13:25:00Z -> in IST (+05:30) is 2026-09-21 18:55 (Monday = day 1)
  const d = new Date('2026-09-21T13:25:00Z');
  const ist = getISTDateTime(d);
  assert.equal(ist.hours, 18);
  assert.equal(ist.minutes, 55);
  assert.equal(ist.dayOfWeek, 1);
});

test('isScheduledTime returns true at 18:55 Mon-Sat', () => {
  assert.equal(isScheduledTime({ dayOfWeek: 1, hours: 18, minutes: 55 }), true); // Mon
  assert.equal(isScheduledTime({ dayOfWeek: 6, hours: 18, minutes: 55 }), true); // Sat
  assert.equal(isScheduledTime({ dayOfWeek: 0, hours: 18, minutes: 55 }), false); // Sun
  assert.equal(isScheduledTime({ dayOfWeek: 1, hours: 18, minutes: 54 }), false);
  assert.equal(isScheduledTime({ dayOfWeek: 1, hours: 19, minutes: 0 }), false);
});

test('createBotDaemon sets up handlers and triggers expected responses', async () => {
  let sentMessages = [];
  let sentPhotos = [];

  const mockNotifier = {
    sendTelegramMessage: async (token, chat, text) => {
      sentMessages.push({ chat, text });
      return { ok: true };
    },
    sendTelegramPhoto: async (token, chat, photo, caption) => {
      sentPhotos.push({ chat, photo, caption });
      return { ok: true };
    },
    startTelegramCommandListener: (opts) => {
      return {
        stop: () => {},
        opts
      };
    },
    stopTelegramCommandListener: () => {}
  };

  const mockSessionController = {
    _active: false,
    isActive() { return this._active; },
    getStatus() {
      return {
        active: this._active,
        meetingId: this._active ? '1234567890' : null,
        attendeeName: this._active ? 'Alex' : null,
        startTime: this._active ? Date.now() - 300000 : null,
        elapsedMinutes: this._active ? 5 : 0
      };
    },
    takeCurrentScreenshot: async () => '/fake/manual_ss.png',
    leaveMeeting: async function() { this._active = false; },
    runMeeting: async function(cfg) { this._active = true; }
  };

  const config = {
    meetingId: '1234567890',
    passcode: 'secret123',
    attendeeName: 'Alex',
    telegramBotToken: 'tok',
    telegramChatId: '12345'
  };

  const daemon = createBotDaemon({
    config,
    sessionController: mockSessionController,
    notifier: mockNotifier
  });

  const { handlers } = daemon;

  // Test /status when idle
  await handlers.onStatus({ chat: { id: '12345' } });
  assert.ok(sentMessages.some(m => m.text.includes('Idle') && m.text.includes('6:55 PM IST')));

  // Test /join when idle
  await handlers.onJoin({ chat: { id: '12345' } });
  assert.ok(sentMessages.some(m => m.text.includes('Launching browser and joining meeting now...')));
  assert.equal(mockSessionController.isActive(), true);

  // Test /status when active
  sentMessages = [];
  await handlers.onStatus({ chat: { id: '12345' } });
  assert.ok(sentMessages.some(m => m.text.includes('In Meeting') && m.text.includes('1234567890')));

  // Test /screenshot when active
  await handlers.onScreenshot({ chat: { id: '12345' } });
  assert.ok(sentPhotos.some(p => p.photo === '/fake/manual_ss.png'));

  // Test /join when already active
  sentMessages = [];
  await handlers.onJoin({ chat: { id: '12345' } });
  assert.ok(sentMessages.some(m => m.text.includes('Already in a meeting.')));

  // Test /leave when active
  sentMessages = [];
  await handlers.onLeave({ chat: { id: '12345' } });
  assert.ok(sentMessages.some(m => m.text.includes('Leaving meeting and closing browser.')));
  assert.equal(mockSessionController.isActive(), false);

  // Test /leave when idle
  sentMessages = [];
  await handlers.onLeave({ chat: { id: '12345' } });
  assert.ok(sentMessages.some(m => m.text.includes('No active meeting to leave.')));

  // Test /help
  sentMessages = [];
  await handlers.onHelp({ chat: { id: '12345' } });
  assert.ok(sentMessages.some(m => m.text.includes('/status') && m.text.includes('/join') && m.text.includes('/screenshot')));

  daemon.stop();
});
