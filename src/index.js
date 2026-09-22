const { getConfig } = require('./config.js');
const {
  sendTelegramMessage,
  sendTelegramPhoto,
  startTelegramCommandListener,
  stopTelegramCommandListener
} = require('./notifier.js');
const { SessionController } = require('./zoom.js');

/**
 * Returns the current date/time parts converted to Asia/Kolkata (IST).
 * @param {Date} [date]
 * @returns {{ dayOfWeek: number, hours: number, minutes: number, dateString: string }}
 */
function getISTDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  }).formatToParts(date);

  const partMap = {};
  for (const part of parts) {
    partMap[part.type] = part.value;
  }

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };

  return {
    dayOfWeek: weekdayMap[partMap.weekday] ?? 0,
    hours: parseInt(partMap.hour, 10),
    minutes: parseInt(partMap.minute, 10),
    dateString: date.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' })
  };
}

/**
 * Checks if the given IST time matches scheduled window:
 * Monday-Saturday (1-6) at 18:55 IST.
 * @param {{ dayOfWeek: number, hours: number, minutes: number }} istTime
 * @returns {boolean}
 */
function isScheduledTime(istTime) {
  const { dayOfWeek, hours, minutes } = istTime;
  const isMonToSat = dayOfWeek >= 1 && dayOfWeek <= 6;
  return isMonToSat && hours === 18 && minutes === 55;
}

/**
 * Creates and sets up the bot daemon with Telegram command handlers and scheduler.
 */
function createBotDaemon({
  config = getConfig(),
  sessionController = new SessionController(),
  notifier = {
    sendTelegramMessage,
    sendTelegramPhoto,
    startTelegramCommandListener,
    stopTelegramCommandListener
  }
} = {}) {
  let cronInterval = null;
  let lastScheduledTriggerDate = null;
  let commandListener = null;

  const handlers = {
    onStatus: async (message) => {
      const chatId = message.chat.id;
      if (sessionController.isActive()) {
        const st = sessionController.getStatus();
        const msg = `[Active] In Meeting\nMeeting ID: <code>${st.meetingId}</code>\nAttendee: <b>${st.attendeeName}</b>\nConnected for: <b>${st.elapsedMinutes} minutes</b>`;
        await notifier.sendTelegramMessage(config.telegramBotToken, chatId, msg);
      } else {
        const msg = `[Idle] No active meeting right now.\nNext scheduled session: <b>Today at 6:55 PM IST</b> (Mon-Sat)`;
        await notifier.sendTelegramMessage(config.telegramBotToken, chatId, msg);
      }
    },

    onScreenshot: async (message) => {
      const chatId = message.chat.id;
      if (!sessionController.isActive()) {
        const msg = `Not currently in any meeting. No screenshot available. Use /join to start one.`;
        await notifier.sendTelegramMessage(config.telegramBotToken, chatId, msg);
        return;
      }

      const snapPath = await sessionController.takeCurrentScreenshot('manual_ss.png');
      if (snapPath) {
        await notifier.sendTelegramPhoto(config.telegramBotToken, chatId, snapPath, 'Current Meeting View');
      } else {
        await notifier.sendTelegramMessage(config.telegramBotToken, chatId, 'Failed to take screenshot.');
      }
    },

    onJoin: async (message) => {
      const chatId = message.chat.id;
      if (sessionController.isActive()) {
        const msg = `Already in a meeting. Use /status or /screenshot.`;
        await notifier.sendTelegramMessage(config.telegramBotToken, chatId, msg);
        return;
      }

      await notifier.sendTelegramMessage(config.telegramBotToken, chatId, `Launching browser and joining meeting now...`);
      // Asynchronously trigger meeting run without blocking command response
      sessionController.runMeeting(config).catch((err) => {
        console.error('[Daemon] Error in session runMeeting:', err);
      });
    },

    onSummary: async (message) => {
      const chatId = message.chat.id;
      if (!sessionController.isActive()) {
        const msg = `Not currently in any meeting. No active Q&A or chat to summarize.`;
        await notifier.sendTelegramMessage(config.telegramBotToken, chatId, msg);
        return;
      }

      await notifier.sendTelegramMessage(config.telegramBotToken, chatId, `Extracting webinar feed and generating summary...`);
      const summary = await sessionController.getMeetingSummary(config.geminiApiKey);
      if (summary) {
        await notifier.sendTelegramMessage(config.telegramBotToken, chatId, `<b>Webinar Summary and Links:</b>\n\n${summary}`);
      } else {
        await notifier.sendTelegramMessage(config.telegramBotToken, chatId, `Failed to generate summary.`);
      }
    },

    onLeave: async (message) => {
      const chatId = message.chat.id;
      if (!sessionController.isActive()) {
        await notifier.sendTelegramMessage(config.telegramBotToken, chatId, `No active meeting to leave.`);
        return;
      }

      // Optionally grab final summary before leaving
      try {
        const summary = await sessionController.getMeetingSummary(config.geminiApiKey);
        if (summary) {
          await notifier.sendTelegramMessage(config.telegramBotToken, chatId, `<b>Meeting Summary Before Leaving:</b>\n\n${summary}`);
        }
      } catch (e) {}

      await sessionController.leaveMeeting();
      await notifier.sendTelegramMessage(config.telegramBotToken, chatId, `Leaving meeting and closing browser.`);
    },

    onHelp: async (message) => {
      const chatId = message.chat.id;
      const helpMsg =
        `<b>Zoom Attendee Bot Commands:</b>\n\n` +
        `• /status - Check if currently connected to a meeting\n` +
        `• /screenshot (or /ss) - Instant meeting screenshot\n` +
        `• /summary - Summary of Q&A questions, answers, and links\n` +
        `• /join - Launch and join the configured meeting\n` +
        `• /leave - Leave the meeting, generate summary, and close browser\n` +
        `• /help - Display this command overview\n\n` +
        `<i>Automated Schedule: Mon-Sat at 6:55 PM IST (18:55)</i>`;
      await notifier.sendTelegramMessage(config.telegramBotToken, chatId, helpMsg);
    }
  };

  const start = () => {
    console.log('[Daemon] Starting Telegram command listener...');
    commandListener = notifier.startTelegramCommandListener({
      token: config.telegramBotToken,
      authorizedChatId: config.telegramChatId,
      handlers
    });

    console.log('[Daemon] Starting 30-second scheduler check for 18:55 IST (Mon-Sat)...');
    cronInterval = setInterval(async () => {
      const now = new Date();
      const ist = getISTDateTime(now);

      if (isScheduledTime(ist)) {
        if (lastScheduledTriggerDate !== ist.dateString) {
          if (!sessionController.isActive()) {
            lastScheduledTriggerDate = ist.dateString;
            console.log(`[Daemon] Scheduled time matched (${ist.dateString} 18:55 IST). Starting meeting...`);
            sessionController.runMeeting(config).catch((err) => {
              console.error('[Daemon] Scheduled meeting error:', err);
            });
          }
        }
      }
    }, 30000);
  };

  const stop = async () => {
    if (cronInterval) {
      clearInterval(cronInterval);
      cronInterval = null;
    }
    if (commandListener) {
      notifier.stopTelegramCommandListener(commandListener);
      commandListener = null;
    }
    if (sessionController.isActive()) {
      await sessionController.leaveMeeting();
    }
  };

  return {
    handlers,
    start,
    stop,
    sessionController,
    config
  };
}

async function main() {
  const config = getConfig();
  const sessionController = new SessionController();
  const daemon = createBotDaemon({ config, sessionController });

  daemon.start();
  console.log('[Zoom Bot] Daemon is running 24/7. Waiting for Telegram commands & scheduled events.');

  const shutdown = async (signal) => {
    console.log(`[Zoom Bot] Received ${signal}. Shutting down gracefully...`);
    await daemon.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  main();
}

module.exports = {
  getISTDateTime,
  isScheduledTime,
  createBotDaemon,
  main
};
