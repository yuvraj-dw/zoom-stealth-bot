const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionController } = require('../src/zoom.js');

test('SessionController starts inactive with empty status', () => {
  const controller = new SessionController();
  assert.equal(controller.isActive(), false);
  const status = controller.getStatus();
  assert.deepEqual(status, {
    active: false,
    meetingId: null,
    attendeeName: null,
    startTime: null,
    elapsedMinutes: 0
  });
});

test('SessionController.getStatus returns active status and elapsedMinutes when active', () => {
  const controller = new SessionController();
  controller.active = true;
  controller.meetingId = '123456789';
  controller.attendeeName = 'Tester';
  controller.startTime = Date.now() - 120000; // 2 minutes ago

  assert.equal(controller.isActive(), true);
  const status = controller.getStatus();
  assert.equal(status.active, true);
  assert.equal(status.meetingId, '123456789');
  assert.equal(status.attendeeName, 'Tester');
  assert.equal(status.elapsedMinutes, 2);
});

test('SessionController.takeCurrentScreenshot captures screenshot of active page', async () => {
  const controller = new SessionController();
  let capturedOpts = null;
  controller.page = {
    screenshot: async (opts) => {
      capturedOpts = opts;
    }
  };
  controller.active = true;

  const res = await controller.takeCurrentScreenshot('manual_ss.png');
  assert.ok(res);
  assert.ok(res.includes('manual_ss.png'));
  assert.equal(capturedOpts.fullPage, true);
});

test('SessionController.takeCurrentScreenshot returns null if inactive or no page', async () => {
  const controller = new SessionController();
  const res = await controller.takeCurrentScreenshot('manual_ss.png');
  assert.equal(res, null);
});

test('SessionController.leaveMeeting safely closes browser and resets state', async () => {
  const controller = new SessionController();
  let closed = false;
  controller.browser = {
    close: async () => {
      closed = true;
    }
  };
  controller.active = true;
  controller.meetingId = '123';
  controller.attendeeName = 'User';
  controller.startTime = Date.now();

  await controller.leaveMeeting();

  assert.equal(closed, true);
  assert.equal(controller.isActive(), false);
  assert.equal(controller.browser, null);
  assert.equal(controller.page, null);
  assert.equal(controller.context, null);
});

test('SessionController.runMeeting returns skipped if already active', async () => {
  const controller = new SessionController();
  controller.active = true;
  const res = await controller.runMeeting({ meetingId: '123' });
  assert.deepEqual(res, { skipped: true, reason: 'already_active' });
});

test('SessionController.runMeeting handles meeting lifecycle and end detection', async () => {
  let joined = false;
  let sentMessages = [];
  let sentPhotos = [];

  const mockDeps = {
    chromium: {
      launch: async () => ({
        newContext: async () => ({
          newPage: async () => ({
            goto: async () => {},
            waitForTimeout: async () => {},
            screenshot: async () => {},
            url: () => 'https://app.zoom.us/postattendee',
            innerText: async () => '',
            locator: () => ({
              first: () => ({
                isVisible: async () => false,
                click: async () => {},
                fill: async () => {}
              })
            })
          })
        }),
        close: async () => {}
      })
    },
    stealth: {
      getChromiumArgs: () => [],
      getUserAgent: () => 'fake-ua',
      setupStealthPage: async () => {}
    },
    notifier: {
      sendTelegramMessage: async (token, chat, msg) => {
        sentMessages.push(msg);
      },
      sendTelegramPhoto: async (token, chat, photo, caption) => {
        sentPhotos.push({ photo, caption });
      }
    },
    sleepFn: async () => {}
  };

  const controller = new SessionController(mockDeps);
  const result = await controller.runMeeting({
    meetingId: '1234567890',
    attendeeName: 'Alex',
    telegramBotToken: 'tok',
    telegramChatId: 'chat'
  });

  assert.equal(result.reason, 'meeting_ended');
  assert.equal(controller.isActive(), false);
  assert.ok(sentMessages.some(m => m.includes('Zoom Bot Starting')));
  assert.ok(sentMessages.some(m => m.includes('Zoom Meeting Ended')));
});

