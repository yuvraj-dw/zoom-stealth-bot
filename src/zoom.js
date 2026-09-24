const fs = require('node:fs');
const path = require('node:path');

const END_INDICATORS = [
  'This meeting has been ended by the host',
  'The host has ended this meeting',
  'This meeting has ended',
  'You have been removed from the meeting',
  'The webinar has ended'
];

/**
 * Builds the Zoom web client join URL.
 * @param {string} meetingId 
 * @param {string} [passcode] 
 * @returns {string}
 */
/**
 * Builds the Zoom web client join URL.
 * @param {string} meetingId 
 * @param {string} [passcode] 
 * @param {string} [webinarToken]
 * @returns {string}
 */
function buildJoinUrl(meetingId, passcode, webinarToken) {
  const cleanId = String(meetingId || '').replace(/\s+/g, '');
  let url = `https://app.zoom.us/wc/${cleanId}/join?prefer=1`;
  if (webinarToken) {
    url += `&tk=${encodeURIComponent(webinarToken)}`;
  } else if (passcode) {
    const encodedPwd = Buffer.from(String(passcode)).toString('base64');
    url += `&pwd=${encodedPwd}`;
  }
  return url;
}

/**
 * Takes a full page screenshot and saves it to dir/filename.
 * @param {import('playwright').Page} page 
 * @param {string} dir 
 * @param {string} filename 
 * @returns {Promise<string|null>}
 */
async function takeSnapshot(page, dir, filename) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, filename);
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  } catch (err) {
    return null;
  }
}

/**
 * Checks if the meeting has ended by inspecting URL and DOM text.
 * @param {import('playwright').Page} page 
 * @returns {Promise<{ ended: boolean, reason?: string }>}
 */
async function isMeetingEnded(page) {
  try {
    const currentUrl = page.url ? page.url() : '';
    if (currentUrl.includes('/postattendee')) {
      return { ended: true, reason: 'URL redirected to /postattendee' };
    }

    const bodyText = await page.innerText('body');
    for (const indicator of END_INDICATORS) {
      if (bodyText.includes(indicator)) {
        return { ended: true, reason: indicator };
      }
    }

    return { ended: false };
  } catch (err) {
    return { ended: false };
  }
}

/**
 * Collapses live streaming subtitle mutations into completed sentences.
 * @param {string[]} rawCaptions 
 * @returns {string[]}
 */
function mergeCaptions(rawCaptions) {
  // ponytail: greedy prefix compaction of rolling live captions
  const merged = [];
  let current = '';

  for (const raw of rawCaptions) {
    const text = String(raw || '')
      .replace(/^Captions are on\s*/i, '')
      .replace(/^[A-Z]{1,3}\s*\n/, '')
      .trim();
    if (!text) continue;

    if (!current) {
      current = text;
    } else if (text.startsWith(current)) {
      current = text;
    } else if (current.startsWith(text)) {
      continue;
    } else {
      merged.push(current);
      current = text;
    }
  }
  if (current) merged.push(current);
  return merged;
}

/**
 * Extracts all Q&A questions, chat messages, and live captions.
 * @param {import('playwright').Page} page 
 * @returns {Promise<{ transcript: string, qaCount: number, chatCount: number, captionCount: number, rawCaptions: string[], qaList: string[], chatList: string[] }>}
 */
async function extractMeetingFeed(page) {
  try {
    const feed = await page.evaluate(() => {
      const root = document.querySelector('#root') || document.body;
      let questions = [];
      let chat = [];

      function walkFiber(node) {
        if (!node) return;
        if (node.memoizedProps) {
          if (node.memoizedProps.questionListMeeting && Array.isArray(node.memoizedProps.questionListMeeting)) {
            questions = node.memoizedProps.questionListMeeting;
          }
          if (node.memoizedProps.meetingChat && Array.isArray(node.memoizedProps.meetingChat)) {
            chat = node.memoizedProps.meetingChat;
          }
        }
        let child = node.child;
        while (child) {
          walkFiber(child);
          child = child.sibling;
        }
      }

      const key = Object.keys(root).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactContainer'));
      if (key) walkFiber(root[key]);

      const formattedQA = questions.map((q, idx) => {
        const asker = q.name || (q.anony ? 'Anonymous' : 'Attendee');
        const answers = (q.answer || []).map(a => `${a.name || 'Host/Mentor'}: ${a.text}`).join('\n');
        return `[Question #${idx + 1} by ${asker}]: ${q.text}${answers ? `\n[Answers]:\n${answers}` : ''}`;
      });

      const formattedChat = chat.map((c, idx) => {
        return `[Chat #${idx + 1} from ${c.sender || c.name || 'User'}]: ${c.text || c.msg || ''}`;
      });

      const rawCaptions = Array.isArray(window.__captions) ? [...window.__captions] : [];

      return {
        qaList: formattedQA,
        chatList: formattedChat,
        rawCaptions
      };
    });

    const cleanCaptions = mergeCaptions(feed.rawCaptions || []);

    const lines = [];
    if (cleanCaptions.length > 0) {
      lines.push('=== HOST SPEECH & LIVE TRANSCRIPTION ===');
      lines.push(...cleanCaptions);
    }
    if (feed.qaList.length > 0) {
      lines.push('\n=== WEBINAR Q&A SECTION ===');
      lines.push(...feed.qaList);
    }
    if (feed.chatList.length > 0) {
      lines.push('\n=== WEBINAR CHAT SECTION ===');
      lines.push(...feed.chatList);
    }

    return {
      transcript: lines.join('\n\n'),
      qaCount: feed.qaList.length,
      chatCount: feed.chatList.length,
      captionCount: cleanCaptions.length,
      rawCaptions: feed.rawCaptions || [],
      qaList: feed.qaList,
      chatList: feed.chatList
    };
  } catch (e) {
    return { transcript: '', qaCount: 0, chatCount: 0, captionCount: 0, rawCaptions: [], qaList: [], chatList: [] };
  }
}

/**
 * Helper to click the first matching selector if visible
 * @param {import('playwright').Page} page 
 * @param {string[]} selectors 
 * @param {number} timeoutMs 
 * @returns {Promise<boolean>}
 */
async function tryClick(page, selectors, timeoutMs = 3000) {
  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: timeoutMs })) {
        await el.click();
        return true;
      }
    } catch {
      // continue to next selector
    }
  }
  return false;
}

/**
 * Helper to fill input using the first matching selector
 * @param {import('playwright').Page} page 
 * @param {string[]} selectors 
 * @param {string} value 
 * @param {number} timeoutMs 
 * @returns {Promise<boolean>}
 */
async function tryFill(page, selectors, value, timeoutMs = 3000) {
  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: timeoutMs })) {
        await el.fill(value);
        return true;
      }
    } catch {
      // continue to next selector
    }
  }
  return false;
}

/**
 * Automates joining a Zoom meeting from the web client.
 * @param {import('playwright').Page} page 
 * @param {Object} config 
 */
async function joinMeeting(page, config) {
  const screenshotsDir = config.screenshotsDir || './screenshots';
  const joinUrl = buildJoinUrl(config.meetingId, config.passcode, config.webinarToken);

  await page.goto(joinUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  await takeSnapshot(page, screenshotsDir, `join-1-initial-${Date.now()}.png`);

  // 1. Accept cookie banner if present
  const cookieSelectors = [
    '#onetrust-accept-btn-handler',
    'button:has-text("Accept All Cookies")',
    'button:has-text("Accept All")',
    'button:has-text("Accept")'
  ];
  await tryClick(page, cookieSelectors, 3000);

  // 1b. Split attendee name into First and Last Name
  const fullName = (config.attendeeName || 'Yuvraj Dwivedi').trim();
  const nameParts = fullName.split(/\s+/);
  const firstName = nameParts[0] || 'Yuvraj';
  const lastName = nameParts.slice(1).join(' ') || 'Dwivedi';

  // Check if this is a Webinar Registration page (exact IDs: #question_first_name, #question_last_name, #question_email)
  const webinarFirstNameSelectors = [
    '#question_first_name',
    'input[id="question_first_name"]',
    'input[placeholder="First Name"]',
    'input[placeholder*="First Name" i]',
    'input[name="first_name"]'
  ];
  const webinarLastNameSelectors = [
    '#question_last_name',
    'input[id="question_last_name"]',
    'input[placeholder="Last Name"]',
    'input[placeholder*="Last Name" i]',
    'input[name="last_name"]'
  ];
  const webinarEmailSelectors = [
    '#question_email',
    'input[id="question_email"]',
    'input[placeholder*="company.com" i]',
    'input[type="email"]',
    'input[name="email"]'
  ];

  const isWebinarRegPage = await page.locator('#question_first_name, #question_last_name, button:has-text("Register and Join")').first().isVisible({ timeout: 4000 }).catch(() => false);

  if (isWebinarRegPage) {
    console.log('[Join] Detected Webinar Registration form. Filling first name, last name, email...');
    
    // First Name
    await tryFill(page, webinarFirstNameSelectors, firstName, 5000);

    // Last Name
    await tryFill(page, webinarLastNameSelectors, lastName, 5000);

    // Email Address
    if (config.attendeeEmail) {
      await tryFill(page, webinarEmailSelectors, config.attendeeEmail, 5000);
    }

    await takeSnapshot(page, screenshotsDir, `join-webinar-filled-${Date.now()}.png`);

    // Submit Webinar Registration directly through Vue or click
    console.log('[Join] Submitting webinar registration...');
    let regSubmitted = await page.evaluate(async () => {
      try {
        const appEl = document.querySelector('#app');
        if (!appEl || !appEl.__vue_app__) return false;
        const app = appEl.__vue_app__;
        function findComp(c, targetName) {
          if (!c) return null;
          if (c.type && (c.type.name === targetName || c.type.__name === targetName)) return c;
          if (c.subTree) {
            const found = findVNode(c.subTree, targetName);
            if (found) return found;
          }
          return null;
        }
        function findVNode(v, targetName) {
          if (!v) return null;
          if (v.component) {
            const found = findComp(v.component, targetName);
            if (found) return found;
          }
          if (Array.isArray(v.children)) {
            for (const child of v.children) {
              if (child && typeof child === 'object') {
                const found = findVNode(child, targetName);
                if (found) return found;
              }
            }
          }
          return null;
        }
        const reg = findComp(app._container._vnode.component, 'Registration');
        if (reg && reg.proxy && typeof reg.proxy.submitRegistration === 'function') {
          reg.proxy.canSkipCaptcha = true;
          reg.proxy.showCaptcha = false;
          await reg.proxy.submitRegistration();
          return true;
        }
        return false;
      } catch (e) {
        return false;
      }
    });

    if (!regSubmitted) {
      regSubmitted = await tryClick(page, [
        'button:has-text("Register and Join")',
        'button:has-text("Register")',
        'button.btn-primary',
        'button[type="submit"]'
      ], 5000);
    }

    console.log(`[Join] Submitted webinar registration: ${regSubmitted}`);
    
    // Wait for URL to update with token or redirect
    try {
      await page.waitForURL(url => url.toString().includes('tk=') || url.toString().includes('/w/'), { timeout: 15000 });
    } catch (e) {
      await page.waitForTimeout(5000);
    }

    // Check if we were redirected to the post-registration landing page or received a token
    const currentUrl = page.url();
    console.log(`[Join] URL after webinar registration: ${currentUrl}`);

    const tkMatch = currentUrl.match(/[?&]tk=([^&#]+)/);
    if (tkMatch && tkMatch[1]) {
      const webinarToken = decodeURIComponent(tkMatch[1]);
      const cleanId = String(config.meetingId || '').replace(/\s+/g, '');
      const directWcUrl = `https://app.zoom.us/wc/${cleanId}/join?tk=${encodeURIComponent(webinarToken)}&prefer=1`;
      console.log(`[Join] Found webinar registration token. Navigating directly to web client join URL: ${directWcUrl}`);
      await page.goto(directWcUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);
    } else {
      // Look for "Join from browser" button if present on the landing page
      const joinFromBrowserBtn = page.locator('button:has-text("Join from browser"), a:has-text("Join from browser")');
      if (await joinFromBrowserBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        console.log('[Join] Clicking "Join from browser" button...');
        await joinFromBrowserBtn.click();
        await page.waitForTimeout(6000);
      }
    }
  }

  // 2. Standard Zoom Web Client Join Form or Passcode Prompt
  // Fill attendee name if input appears
  const nameSelectors = [
    'input#input-for-name',
    'input[name="inputname"]',
    'input[placeholder*="name" i]',
    'input[aria-label*="name" i]'
  ];
  if (config.attendeeName) {
    await tryFill(page, nameSelectors, config.attendeeName, 3000);
  }

  // 3. Fill email if requested
  const emailSelectors = [
    'input#input-for-email',
    'input[name="inputemail"]',
    'input[type="email"]',
    'input[placeholder*="email" i]'
  ];
  if (config.attendeeEmail) {
    await tryFill(page, emailSelectors, config.attendeeEmail, 2000);
  }

  // 4. Fill passcode if prompted
  const passcodeSelectors = [
    'input#input-for-pwd',
    'input[name="inputpasscode"]',
    'input[type="password"]',
    'input[placeholder*="passcode" i]',
    'input[placeholder*="password" i]'
  ];
  if (config.passcode) {
    const filledPasscode = await tryFill(page, passcodeSelectors, config.passcode, 4000);
    if (filledPasscode) {
      console.log('[Join] Entered meeting passcode into prompt.');
      await page.waitForTimeout(1000);
    }
  }

  await takeSnapshot(page, screenshotsDir, `join-2-filled-${Date.now()}.png`);

  // 5. Click join button if visible
  const joinButtonSelectors = [
    'button.preview-join-button:not(.disabled):not([disabled])',
    'button.preview-join-button',
    'button#preview-join-button',
    'button:has-text("Join")',
    'button[type="submit"]'
  ];
  await tryClick(page, joinButtonSelectors, 5000);

  // Re-check: If passcode prompt or join button is still present, re-fill and click
  for (let attempt = 0; attempt < 3; attempt++) {
    const pwdInput = page.locator('#input-for-pwd, input[name="inputpasscode"]').first();
    if (pwdInput && typeof pwdInput.isVisible === 'function' && await pwdInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log(`[Join] Passcode input still visible (attempt ${attempt + 1}), filling passcode...`);
      if (typeof pwdInput.fill === 'function') {
        await pwdInput.fill(config.passcode || '').catch(() => {});
      }
      await page.waitForTimeout(1000);
      const joinBtn = page.locator('button.preview-join-button, button:has-text("Join")').first();
      if (joinBtn && typeof joinBtn.isVisible === 'function' && await joinBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        if (typeof joinBtn.click === 'function') {
          await joinBtn.click().catch(() => {});
        }
        await page.waitForTimeout(4000);
      }
    } else {
      break;
    }
  }

  await page.waitForTimeout(6000);

  // 6. Accept ToS / terms modal if present
  const tosSelectors = [
    'button:has-text("I Agree")',
    'button:has-text("Agree")',
    'button:has-text("Accept")',
    '#wc_agree1'
  ];
  await tryClick(page, tosSelectors, 3000);

  // 7. Click "Join Audio by Computer" if present
  const audioSelectors = [
    'button:has-text("Join Audio by Computer")',
    'button:has-text("Computer Audio")',
    'button:has-text("Join Audio")',
    '.join-audio-by-voip'
  ];
  await tryClick(page, audioSelectors, 5000);

  await page.waitForTimeout(3000);

  // 8. Enable live captions/subtitles if available
  // ponytail: enable closed captions and collect speech stream into window.__captions
  try {
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => 
        (b.getAttribute('aria-label') || '').includes('Show Captions') || b.innerText.includes('Show Captions')
      );
      if (btn) btn.click();

      if (!window.__captions) {
        window.__captions = [];
        let last = '';
        const obs = new MutationObserver(() => {
          const items = document.querySelectorAll('.live-transcription-subtitle__item, .live-transcription-subtitle__box');
          for (const el of items) {
            const txt = (el.innerText || '').trim();
            if (txt && txt !== last) {
              last = txt;
              window.__captions.push(txt);
            }
          }
        });
        obs.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
    });
  } catch (e) {
    // ignore if caption setup fails
  }

  const finalSnapshot = await takeSnapshot(page, screenshotsDir, `join-3-connected-${Date.now()}.png`);

  return { success: true, snapshot: finalSnapshot };
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

class SessionController {
  constructor(deps = {}) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.active = false;
    this.meetingId = null;
    this.attendeeName = null;
    this.startTime = null;
    this.screenshotsDir = './screenshots';
    this.deps = deps;
    this._stopRequested = false;
  }

  isActive() {
    return this.active;
  }

  getStatus() {
    if (!this.active) {
      return {
        active: false,
        meetingId: null,
        attendeeName: null,
        startTime: null,
        elapsedMinutes: 0
      };
    }
    const elapsedMs = Date.now() - (this.startTime || Date.now());
    const elapsedMinutes = Math.floor(elapsedMs / (60 * 1000));
    return {
      active: true,
      meetingId: this.meetingId,
      attendeeName: this.attendeeName,
      startTime: this.startTime,
      elapsedMinutes
    };
  }

  async takeCurrentScreenshot(filename = 'manual_ss.png') {
    if (!this.active || !this.page) {
      return null;
    }
    return await takeSnapshot(this.page, this.screenshotsDir, filename);
  }

  async getMeetingSummary(apiKey, preferredModel, logsDir = './logs') {
    if (!this.active || !this.page) {
      return null;
    }
    const feed = await extractMeetingFeed(this.page);
    if (!feed.transcript) {
      return 'No chat messages or Q&A questions are available yet in this session.';
    }
    const { summarizeMeetingFeed } = require('./summarizer.js');
    const summary = await summarizeMeetingFeed(feed.transcript, apiKey, preferredModel);

    // ponytail: live disk persistence on every summary extraction
    try {
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `meeting-${this.meetingId || 'active'}-${timestamp}.json`);
      fs.writeFileSync(logFile, JSON.stringify({
        meetingId: this.meetingId,
        attendeeName: this.attendeeName,
        startTime: this.startTime,
        timestamp: new Date().toISOString(),
        qaCount: feed.qaCount,
        chatCount: feed.chatCount,
        captionCount: feed.captionCount,
        rawCaptions: feed.rawCaptions,
        qaList: feed.qaList,
        chatList: feed.chatList,
        transcript: feed.transcript,
        summary
      }, null, 2), 'utf-8');
      console.log(`[SessionController] Logged captions, chat, and summary to: ${logFile}`);
    } catch (e) {
      console.error('[SessionController] Failed to write log file:', e);
    }

    return summary;
  }

  async leaveMeeting() {
    this._stopRequested = true;
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (err) {
        // ignore error on close
      }
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.active = false;
    this.meetingId = null;
    this.attendeeName = null;
    this.startTime = null;
  }

  async runMeeting(config) {
    if (this.active) {
      console.warn('[SessionController] A meeting is already active.');
      return { skipped: true, reason: 'already_active' };
    }

    const { chromium } = this.deps.chromium ? this.deps : require('playwright');
    const { getChromiumArgs, getUserAgent, setupStealthPage } = this.deps.stealth || require('./stealth.js');
    const { sendTelegramMessage, sendTelegramPhoto } = this.deps.notifier || require('./notifier.js');

    this._stopRequested = false;
    this.screenshotsDir = config.screenshotsDir || './screenshots';
    this.meetingId = config.meetingId;
    this.attendeeName = config.attendeeName;
    this.startTime = Date.now();
    this.active = true;

    try {
      // 1. Notify startup
      const startTimeStr = new Date(this.startTime).toLocaleString();
      await sendTelegramMessage(
        config.telegramBotToken,
        config.telegramChatId,
        `<b>Zoom Bot Starting</b>\n` +
        `• <b>Meeting ID:</b> <code>${config.meetingId}</code>\n` +
        `• <b>Attendee:</b> ${config.attendeeName}\n` +
        `• <b>Start Time:</b> ${startTimeStr}`
      );

      // 2. Launch browser with stealth
      console.log('[SessionController] Launching Playwright browser...');
      this.browser = await chromium.launch({
        headless: true,
        args: getChromiumArgs()
      });

      this.context = await this.browser.newContext({
        userAgent: getUserAgent(),
        viewport: { width: 1920, height: 1080 },
        permissions: ['microphone', 'camera']
      });

      this.page = await this.context.newPage();
      await setupStealthPage(this.page);

      // 3. Join meeting
      console.log('[SessionController] Joining meeting...');
      const joinResult = await joinMeeting(this.page, config);

      if (this._stopRequested) {
        await this.leaveMeeting();
        return { reason: 'stopped', durationMs: Date.now() - this.startTime };
      }

      // 4. Send joined confirmation photo
      console.log('[SessionController] Joined meeting. Sending confirmation...');
      const initialSnap = joinResult.snapshot || await takeSnapshot(this.page, this.screenshotsDir, `joined-${Date.now()}.png`);
      if (initialSnap) {
        await sendTelegramPhoto(
          config.telegramBotToken,
          config.telegramChatId,
          initialSnap,
          `<b>Zoom Bot Joined Meeting</b>\n` +
          `• <b>Meeting ID:</b> <code>${config.meetingId}</code>\n` +
          `• <b>Attendee:</b> ${config.attendeeName}`
        );
      } else {
        await sendTelegramMessage(
          config.telegramBotToken,
          config.telegramChatId,
          `<b>Zoom Bot Joined Meeting</b>\n` +
          `• <b>Meeting ID:</b> <code>${config.meetingId}</code>\n` +
          `• <b>Attendee:</b> ${config.attendeeName}`
        );
      }

      // 5. Run 15-second polling loop
      console.log('[SessionController] Entering presence loop...');
      const heartbeatIntervalMs = (config.heartbeatIntervalMinutes || 30) * 60 * 1000;
      const maxDurationMs = (config.maxDurationMinutes || 180) * 60 * 1000;
      const pollingIntervalMs = 15000;
      let lastHeartbeatTime = Date.now();

      const sleepFn = this.deps.sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

      while (!this._stopRequested) {
        await sleepFn(pollingIntervalMs);
        if (this._stopRequested) break;

        const now = Date.now();
        const elapsedMs = now - this.startTime;

        // Check meeting ended
        const endedStatus = await isMeetingEnded(this.page);
        if (endedStatus.ended) {
          console.log(`[SessionController] Meeting ended: ${endedStatus.reason || 'Host ended meeting'}`);
          const snapPath = await takeSnapshot(this.page, this.screenshotsDir, `ended-${Date.now()}.png`);
          const durationStr = formatDuration(elapsedMs);

          // Extract feed and generate AI summary before closing
          let summaryText = null;
          try {
            const feed = await extractMeetingFeed(this.page);
            if (feed.transcript && config.geminiApiKey) {
              const { summarizeMeetingFeed } = require('./summarizer.js');
              summaryText = await summarizeMeetingFeed(feed.transcript, config.geminiApiKey, config.geminiModel);
            }

            // Save raw meeting log and summary to disk
            // ponytail: zero-dependency disk persistence using node:fs
            const logsDir = config.logsDir || './logs';
            if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logFile = path.join(logsDir, `meeting-${config.meetingId}-${timestamp}.json`);
            fs.writeFileSync(logFile, JSON.stringify({
              meetingId: config.meetingId,
              attendeeName: config.attendeeName,
              startTime: this.startTime,
              durationMs: elapsedMs,
              qaCount: feed.qaCount,
              chatCount: feed.chatCount,
              captionCount: feed.captionCount,
              rawCaptions: feed.rawCaptions,
              qaList: feed.qaList,
              chatList: feed.chatList,
              transcript: feed.transcript,
              summary: summaryText
            }, null, 2), 'utf-8');
            console.log(`[SessionController] Saved meeting logs and summary to: ${logFile}`);
          } catch (e) {
            console.error('[SessionController] Error generating summary or saving log on end:', e);
          }

          await sendTelegramMessage(
            config.telegramBotToken,
            config.telegramChatId,
            `<b>Zoom Meeting Ended</b>\n` +
            `• <b>Reason:</b> ${endedStatus.reason || 'Host ended meeting'}\n` +
            `• <b>Total Duration:</b> ${durationStr}`
          );

          if (snapPath) {
            await sendTelegramPhoto(
              config.telegramBotToken,
              config.telegramChatId,
              snapPath,
              `Meeting ended screen capture (${durationStr})`
            );
          }

          if (summaryText) {
            await sendTelegramMessage(
              config.telegramBotToken,
              config.telegramChatId,
              `<b>Webinar Summary & Links</b>\n\n${summaryText}`
            );
          }

          await this.leaveMeeting();
          return { reason: 'meeting_ended', durationMs: elapsedMs };
        }

        // Check heartbeat interval
        if (now - lastHeartbeatTime >= heartbeatIntervalMs) {
          console.log('[SessionController] Sending heartbeat...');
          lastHeartbeatTime = now;
          const snapPath = await takeSnapshot(this.page, this.screenshotsDir, `heartbeat-${Date.now()}.png`);
          const durationStr = formatDuration(elapsedMs);

          if (snapPath) {
            await sendTelegramPhoto(
              config.telegramBotToken,
              config.telegramChatId,
              snapPath,
              `<b>Zoom Bot Heartbeat</b>\n• Running for: ${durationStr}`
            );
          } else {
            await sendTelegramMessage(
              config.telegramBotToken,
              config.telegramChatId,
              `<b>Zoom Bot Heartbeat</b>\n• Running for: ${durationStr}`
            );
          }
        }

        // Check safety max duration
        if (elapsedMs >= maxDurationMs) {
          console.log('[SessionController] Max duration reached.');
          const snapPath = await takeSnapshot(this.page, this.screenshotsDir, `timeout-${Date.now()}.png`);
          const durationStr = formatDuration(elapsedMs);

          await sendTelegramMessage(
            config.telegramBotToken,
            config.telegramChatId,
            `<b>Zoom Bot Max Duration Reached</b>\n` +
            `• Reached maximum limit: ${config.maxDurationMinutes} minutes.\n` +
            `• Leaving meeting safely.`
          );

          if (snapPath) {
            await sendTelegramPhoto(
              config.telegramBotToken,
              config.telegramChatId,
              snapPath,
              `Timeout snapshot (${durationStr})`
            );
          }
          await this.leaveMeeting();
          return { reason: 'max_duration', durationMs: elapsedMs };
        }
      }

      await this.leaveMeeting();
      return { reason: 'stopped', durationMs: Date.now() - this.startTime };
    } catch (err) {
      console.error('[SessionController] Error during meeting run:', err);

      let errorSnapPath = null;
      if (this.page) {
        errorSnapPath = await takeSnapshot(this.page, this.screenshotsDir, `error-${Date.now()}.png`);
      }

      const { sendTelegramMessage, sendTelegramPhoto } = this.deps.notifier || require('./notifier.js');
      const errorMsg = `<b>Zoom Bot Error Alert</b>\n<pre>${err.stack || err.message || String(err)}</pre>`;
      await sendTelegramMessage(config.telegramBotToken, config.telegramChatId, errorMsg);

      if (errorSnapPath) {
        await sendTelegramPhoto(
          config.telegramBotToken,
          config.telegramChatId,
          errorSnapPath,
          `Error state snapshot`
        );
      }

      await this.leaveMeeting();
      throw err;
    }
  }
}

module.exports = {
  buildJoinUrl,
  takeSnapshot,
  isMeetingEnded,
  joinMeeting,
  SessionController,
  formatDuration,
  mergeCaptions
};
