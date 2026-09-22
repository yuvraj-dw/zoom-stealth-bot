const https = require('node:https');
const fs = require('node:fs');

function buildTelegramPayload(chatId, text, extra = {}) {
  return {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...extra
  };
}

function sendTelegramMessage(token, chatId, text, extra = {}, requestFn = https.request) {
  if (!token || !chatId) {
    return Promise.resolve({ ok: false, skipped: true, reason: 'Missing token or chatId' });
  }

  const payload = buildTelegramPayload(chatId, text, extra);
  const data = JSON.stringify(payload);

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };

  return new Promise((resolve, reject) => {
    const req = requestFn(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          resolve(parsed);
        } catch (err) {
          resolve({ ok: false, raw: responseBody, error: err.message });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(data);
    req.end();
  });
}

function sendTelegramPhoto(token, chatId, photo, caption = '', extra = {}, requestFn = https.request) {
  if (!token || !chatId) {
    return Promise.resolve({ ok: false, skipped: true, reason: 'Missing token or chatId' });
  }

  let photoBuffer;
  if (Buffer.isBuffer(photo)) {
    photoBuffer = photo;
  } else if (typeof photo === 'string') {
    if (fs.existsSync(photo)) {
      photoBuffer = fs.readFileSync(photo);
    } else {
      photoBuffer = Buffer.from(photo);
    }
  } else {
    photoBuffer = Buffer.from(photo || '');
  }

  const boundary = `----TelegramBoundary${Date.now()}`;
  const crlf = '\r\n';

  const formFields = {
    chat_id: chatId,
    parse_mode: 'HTML',
    ...extra
  };

  if (caption) {
    formFields.caption = caption;
  }

  const bodyParts = [];

  for (const [key, val] of Object.entries(formFields)) {
    bodyParts.push(Buffer.from(
      `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="${key}"${crlf}${crlf}` +
      `${val}${crlf}`
    ));
  }

  bodyParts.push(Buffer.from(
    `--${boundary}${crlf}` +
    `Content-Disposition: form-data; name="photo"; filename="screenshot.png"${crlf}` +
    `Content-Type: image/png${crlf}${crlf}`
  ));

  bodyParts.push(photoBuffer);
  bodyParts.push(Buffer.from(`${crlf}--${boundary}--${crlf}`));

  const fullBody = Buffer.concat(bodyParts);

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${token}/sendPhoto`,
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': fullBody.length
    }
  };

  return new Promise((resolve, reject) => {
    const req = requestFn(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          resolve(parsed);
        } catch (err) {
          resolve({ ok: false, raw: responseBody, error: err.message });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(fullBody);
    req.end();
  });
}

function getTelegramUpdates(token, offset = 0, timeoutSec = 20, requestFn = https.request) {
  if (!token) {
    return Promise.resolve({ ok: false, skipped: true, reason: 'Missing token' });
  }

  const queryParams = new URLSearchParams();
  if (offset !== undefined && offset !== null) {
    queryParams.set('offset', String(offset));
  }
  if (timeoutSec !== undefined && timeoutSec !== null) {
    queryParams.set('timeout', String(timeoutSec));
  }

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${token}/getUpdates?${queryParams.toString()}`,
    method: 'GET'
  };

  return new Promise((resolve, reject) => {
    const req = requestFn(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          resolve(parsed);
        } catch (err) {
          resolve({ ok: false, raw: responseBody, error: err.message });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

function parseTelegramCommand(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  const parts = trimmed.split(/\s+/);
  let rawCmd = parts[0].substring(1);
  // Strip bot mention if in form /command@botname
  if (rawCmd.includes('@')) {
    rawCmd = rawCmd.split('@')[0];
  }
  rawCmd = rawCmd.toLowerCase();

  const args = parts.slice(1);

  let command = rawCmd;
  if (rawCmd === 'ss') {
    command = 'screenshot';
  } else if (rawCmd === 'start') {
    command = 'help';
  }

  return { command, args };
}

function startTelegramCommandListener({
  token,
  authorizedChatId,
  handlers = {},
  getUpdatesFn = getTelegramUpdates,
  pollIntervalMs = 1000,
  timeoutSec = 20
}) {
  let isRunning = true;
  let currentOffset = 0;
  let activeTimer = null;

  const listener = {
    stop() {
      isRunning = false;
      if (activeTimer) {
        clearTimeout(activeTimer);
        activeTimer = null;
      }
    }
  };

  const poll = async () => {
    if (!isRunning) return;

    try {
      const response = await getUpdatesFn(token, currentOffset, timeoutSec);
      if (response && response.ok && Array.isArray(response.result)) {
        for (const update of response.result) {
          if (update.update_id >= currentOffset) {
            currentOffset = update.update_id + 1;
          }

          const message = update.message || update.edited_message;
          if (!message || !message.text) continue;

          // Validate chat authorization
          const msgChatId = String(message.chat?.id || '');
          const allowedChatId = String(authorizedChatId || '');

          if (allowedChatId && msgChatId !== allowedChatId) {
            console.warn(`[TelegramBot] Ignoring command from unauthorized chat ID: ${msgChatId}`);
            continue;
          }

          const parsed = parseTelegramCommand(message.text);
          if (!parsed) continue;

          const { command, args } = parsed;

          try {
            switch (command) {
              case 'status':
                if (typeof handlers.onStatus === 'function') {
                  await handlers.onStatus(message, args);
                }
                break;
              case 'screenshot':
                if (typeof handlers.onScreenshot === 'function') {
                  await handlers.onScreenshot(message, args);
                }
                break;
              case 'summary':
                if (typeof handlers.onSummary === 'function') {
                  await handlers.onSummary(message, args);
                }
                break;
              case 'join':
                if (typeof handlers.onJoin === 'function') {
                  await handlers.onJoin(message, args);
                }
                break;
              case 'leave':
                if (typeof handlers.onLeave === 'function') {
                  await handlers.onLeave(message, args);
                }
                break;
              case 'help':
                if (typeof handlers.onHelp === 'function') {
                  await handlers.onHelp(message, args);
                }
                break;
              default:
                if (typeof handlers.onUnknown === 'function') {
                  await handlers.onUnknown(message, command, args);
                }
                break;
            }
          } catch (handlerErr) {
            console.error(`[TelegramBot] Error executing handler for /${command}:`, handlerErr);
          }
        }
      }
    } catch (err) {
      console.error('[TelegramBot] Long-polling error:', err);
    }

    if (isRunning) {
      activeTimer = setTimeout(poll, pollIntervalMs);
    }
  };

  // Start polling
  poll();

  return listener;
}

function stopTelegramCommandListener(listener) {
  if (listener && typeof listener.stop === 'function') {
    listener.stop();
  }
}

module.exports = {
  buildTelegramPayload,
  sendTelegramMessage,
  sendTelegramPhoto,
  getTelegramUpdates,
  parseTelegramCommand,
  startTelegramCommandListener,
  stopTelegramCommandListener
};
