const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  buildTelegramPayload,
  sendTelegramMessage,
  sendTelegramPhoto,
  getTelegramUpdates,
  parseTelegramCommand,
  startTelegramCommandListener,
  stopTelegramCommandListener
} = require('../src/notifier.js');

test('buildTelegramPayload builds correct payload structure', () => {
  const payload = buildTelegramPayload('123456', 'Hello World', { disable_notification: true });

  assert.deepEqual(payload, {
    chat_id: '123456',
    text: 'Hello World',
    parse_mode: 'HTML',
    disable_notification: true
  });
});

test('sendTelegramMessage skips sending when token or chatId is missing', async () => {
  const res1 = await sendTelegramMessage('', '12345', 'test message');
  assert.equal(res1.skipped, true);

  const res2 = await sendTelegramMessage('token123', '', 'test message');
  assert.equal(res2.skipped, true);
});

test('sendTelegramMessage sends https request to telegram api and returns parsed response', async () => {
  let capturedOptions = null;
  let capturedBody = '';

  const mockRequest = (options, callback) => {
    capturedOptions = options;
    const req = new EventEmitter();
    req.write = (chunk) => {
      capturedBody += chunk;
    };
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      callback(res);
      res.emit('data', JSON.stringify({ ok: true, result: { message_id: 99 } }));
      res.emit('end');
    };
    return req;
  };

  const response = await sendTelegramMessage('MY_TOKEN', 'MY_CHAT', 'Meeting Started', {}, mockRequest);

  assert.equal(response.ok, true);
  assert.equal(response.result.message_id, 99);
  assert.equal(capturedOptions.hostname, 'api.telegram.org');
  assert.equal(capturedOptions.path, '/botMY_TOKEN/sendMessage');
  assert.equal(capturedOptions.method, 'POST');
  assert.equal(capturedOptions.headers['Content-Type'], 'application/json');

  const parsedBody = JSON.parse(capturedBody);
  assert.equal(parsedBody.chat_id, 'MY_CHAT');
  assert.equal(parsedBody.text, 'Meeting Started');
});

test('sendTelegramPhoto skips sending when token or chatId is missing', async () => {
  const res1 = await sendTelegramPhoto('', '12345', Buffer.from('fake'));
  assert.equal(res1.skipped, true);

  const res2 = await sendTelegramPhoto('token123', '', Buffer.from('fake'));
  assert.equal(res2.skipped, true);
});

test('sendTelegramPhoto sends multipart request with photo buffer and caption', async () => {
  let capturedOptions = null;
  const chunks = [];

  const mockRequest = (options, callback) => {
    capturedOptions = options;
    const req = new EventEmitter();
    req.write = (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      callback(res);
      res.emit('data', JSON.stringify({ ok: true, result: { photo: [{ file_id: 'abc' }] } }));
      res.emit('end');
    };
    return req;
  };

  const fakeImage = Buffer.from('fake-image-bytes');
  const response = await sendTelegramPhoto(
    'MY_TOKEN',
    'MY_CHAT',
    fakeImage,
    'Screenshot caption',
    {},
    mockRequest
  );

  assert.equal(response.ok, true);
  assert.equal(capturedOptions.hostname, 'api.telegram.org');
  assert.equal(capturedOptions.path, '/botMY_TOKEN/sendPhoto');
  assert.equal(capturedOptions.method, 'POST');
  assert.match(capturedOptions.headers['Content-Type'], /^multipart\/form-data; boundary=/);

  const totalBody = Buffer.concat(chunks).toString('utf-8');
  assert.ok(totalBody.includes('name="chat_id"'));
  assert.ok(totalBody.includes('MY_CHAT'));
  assert.ok(totalBody.includes('name="caption"'));
  assert.ok(totalBody.includes('Screenshot caption'));
  assert.ok(totalBody.includes('fake-image-bytes'));
});

test('sendTelegramPhoto handles file path input properly', async () => {
  const tmpFile = path.join(os.tmpdir(), `test-screenshot-${Date.now()}.png`);
  fs.writeFileSync(tmpFile, 'png-binary-data');

  let capturedBody = '';
  const mockRequest = (options, callback) => {
    const req = new EventEmitter();
    req.write = (chunk) => {
      capturedBody += chunk.toString();
    };
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      callback(res);
      res.emit('data', JSON.stringify({ ok: true }));
      res.emit('end');
    };
    return req;
  };

  try {
    const response = await sendTelegramPhoto('TOKEN', 'CHAT', tmpFile, 'From path', {}, mockRequest);
    assert.equal(response.ok, true);
    assert.ok(capturedBody.includes('png-binary-data'));
  } finally {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  }
});

test('getTelegramUpdates returns empty array or skips if token is missing', async () => {
  const res = await getTelegramUpdates('', 0, 10);
  assert.deepEqual(res, { ok: false, skipped: true, reason: 'Missing token' });
});

test('getTelegramUpdates calls https GET with offset and timeoutSec', async () => {
  let capturedOptions = null;
  const mockRequest = (options, callback) => {
    capturedOptions = options;
    const req = new EventEmitter();
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      callback(res);
      res.emit('data', JSON.stringify({
        ok: true,
        result: [{ update_id: 101, message: { text: '/status', chat: { id: 12345 } } }]
      }));
      res.emit('end');
    };
    return req;
  };

  const data = await getTelegramUpdates('TEST_TOKEN', 50, 15, mockRequest);
  assert.equal(data.ok, true);
  assert.equal(data.result.length, 1);
  assert.equal(data.result[0].update_id, 101);
  assert.equal(capturedOptions.hostname, 'api.telegram.org');
  assert.equal(capturedOptions.path, '/botTEST_TOKEN/getUpdates?offset=50&timeout=15');
  assert.equal(capturedOptions.method, 'GET');
});

test('parseTelegramCommand correctly extracts commands and parameters', () => {
  assert.deepEqual(parseTelegramCommand('/status'), { command: 'status', args: [] });
  assert.deepEqual(parseTelegramCommand('/status@MyBot'), { command: 'status', args: [] });
  assert.deepEqual(parseTelegramCommand('/screenshot'), { command: 'screenshot', args: [] });
  assert.deepEqual(parseTelegramCommand('/ss'), { command: 'screenshot', args: [] });
  assert.deepEqual(parseTelegramCommand('/join 123456 789'), { command: 'join', args: ['123456', '789'] });
  assert.deepEqual(parseTelegramCommand('/leave'), { command: 'leave', args: [] });
  assert.deepEqual(parseTelegramCommand('/help'), { command: 'help', args: [] });
  assert.deepEqual(parseTelegramCommand('/start'), { command: 'help', args: [] });
  assert.deepEqual(parseTelegramCommand('hello world'), null);
  assert.deepEqual(parseTelegramCommand(''), null);
});

test('startTelegramCommandListener polls updates, filters by telegramChatId, and dispatches commands', async () => {
  let statusCalled = false;
  let screenshotCalled = false;
  let helpCalled = false;
  let unknownCalled = false;
  let unauthorizedCalled = false;

  let joinCalled = false;
  let leaveCalled = false;

  const updatesQueue = [
    // Update 1: valid command from authorized chat
    {
      ok: true,
      result: [
        {
          update_id: 1,
          message: {
            text: '/status',
            chat: { id: '99999' }
          }
        },
        // Unauthorized chat: should be ignored or not trigger handlers
        {
          update_id: 2,
          message: {
            text: '/leave',
            chat: { id: '88888' }
          }
        },
        // Alias command /ss from authorized chat
        {
          update_id: 3,
          message: {
            text: '/ss',
            chat: { id: 99999 }
          }
        }
      ]
    },
    // Update 2: help, join, leave commands
    {
      ok: true,
      result: [
        {
          update_id: 4,
          message: {
            text: '/help',
            chat: { id: '99999' }
          }
        },
        {
          update_id: 5,
          message: {
            text: '/join 12345 67890',
            chat: { id: '99999' }
          }
        },
        {
          update_id: 6,
          message: {
            text: '/leave',
            chat: { id: '99999' }
          }
        }
      ]
    }
  ];

  let pollIndex = 0;
  const mockGetUpdates = async (offset, timeoutSec) => {
    if (pollIndex < updatesQueue.length) {
      return updatesQueue[pollIndex++];
    }
    // Return empty result afterwards
    return { ok: true, result: [] };
  };

  let joinArgs = [];
  const handlers = {
    onStatus: async (msg) => { statusCalled = true; },
    onScreenshot: async (msg) => { screenshotCalled = true; },
    onHelp: async (msg) => { helpCalled = true; },
    onJoin: async (msg, args) => { joinCalled = true; joinArgs = args; },
    onLeave: async (msg) => { leaveCalled = true; }
  };

  const listener = startTelegramCommandListener({
    token: 'TEST_TOKEN',
    authorizedChatId: '99999',
    handlers,
    getUpdatesFn: mockGetUpdates,
    pollIntervalMs: 10
  });

  // Wait briefly for poll cycles
  await new Promise((r) => setTimeout(r, 80));

  stopTelegramCommandListener(listener);

  assert.equal(statusCalled, true);
  assert.equal(screenshotCalled, true);
  assert.equal(helpCalled, true);
  assert.equal(joinCalled, true);
  assert.deepEqual(joinArgs, ['12345', '67890']);
  assert.equal(leaveCalled, true);
});
