const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  buildJoinUrl,
  takeSnapshot,
  isMeetingEnded
} = require('../src/zoom.js');

test('buildJoinUrl returns correct join url without passcode and strips spaces', () => {
  const url1 = buildJoinUrl('123 456 7890');
  assert.equal(url1, 'https://app.zoom.us/wc/1234567890/join?prefer=1');

  const url2 = buildJoinUrl('123456789', '');
  assert.equal(url2, 'https://app.zoom.us/wc/123456789/join?prefer=1');

  const url3 = buildJoinUrl('  123 456  789  ', null);
  assert.equal(url3, 'https://app.zoom.us/wc/123456789/join?prefer=1');
});

test('buildJoinUrl returns correct join url with base64 encoded passcode', () => {
  const url = buildJoinUrl('123 456 7890', 'secret123');
  const expectedPwd = Buffer.from('secret123').toString('base64');
  assert.equal(url, `https://app.zoom.us/wc/1234567890/join?prefer=1&pwd=${expectedPwd}`);
});

test('takeSnapshot saves full page screenshot to target dir and returns filePath', async () => {
  const tmpDir = path.join(os.tmpdir(), `zoom-test-snapshots-${Date.now()}`);
  const filename = 'test-snap.png';

  let screenshotOptions = null;
  const mockPage = {
    screenshot: async (opts) => {
      screenshotOptions = opts;
      fs.writeFileSync(opts.path, 'dummy-png-data');
    }
  };

  const savedPath = await takeSnapshot(mockPage, tmpDir, filename);

  assert.equal(savedPath, path.join(tmpDir, filename));
  assert.equal(screenshotOptions.fullPage, true);
  assert.equal(fs.existsSync(savedPath), true);

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('takeSnapshot returns null on error without throwing', async () => {
  const mockPage = {
    screenshot: async () => {
      throw new Error('Screenshot failed');
    }
  };

  const savedPath = await takeSnapshot(mockPage, os.tmpdir(), 'error.png');
  assert.equal(savedPath, null);
});

test('isMeetingEnded returns false when URL is normal and no end indicators in DOM', async () => {
  const mockPage = {
    url: () => 'https://app.zoom.us/wc/1234567890/join?prefer=1',
    innerText: async (selector) => {
      return 'Meeting in progress... Participants (5)';
    }
  };

  const result = await isMeetingEnded(mockPage);
  assert.deepEqual(result, { ended: false });
});

test('isMeetingEnded returns true when URL contains /postattendee', async () => {
  const mockPage = {
    url: () => 'https://app.zoom.us/postattendee',
    innerText: async () => ''
  };

  const result = await isMeetingEnded(mockPage);
  assert.equal(result.ended, true);
  assert.match(result.reason, /postattendee/i);
});

test('isMeetingEnded detects all meeting ended indicators in DOM text', async () => {
  const indicators = [
    'This meeting has been ended by the host',
    'The host has ended this meeting',
    'This meeting has ended',
    'You have been removed from the meeting',
    'The webinar has ended'
  ];

  for (const phrase of indicators) {
    const mockPage = {
      url: () => 'https://app.zoom.us/wc/1234567890/start',
      innerText: async (selector) => `Alert: ${phrase}. Please close your browser.`
    };

    const result = await isMeetingEnded(mockPage);
    assert.equal(result.ended, true, `Should detect ended for phrase: "${phrase}"`);
    assert.equal(result.reason, phrase);
  }
});

test('isMeetingEnded handles DOM evaluation errors gracefully', async () => {
  const mockPage = {
    url: () => 'https://app.zoom.us/wc/123/join',
    innerText: async () => {
      throw new Error('Context destroyed');
    }
  };

  const result = await isMeetingEnded(mockPage);
  assert.equal(result.ended, false);
});

test('joinMeeting navigates and interacts with expected selectors', async () => {
  const { joinMeeting } = require('../src/zoom.js');

  const clickedSelectors = [];
  const filledInputs = [];
  let navigatedUrl = null;

  const mockPage = {
    goto: async (url) => {
      navigatedUrl = url;
    },
    waitForTimeout: async () => {},
    screenshot: async () => {},
    locator: (selector) => ({
      first: () => ({
        isVisible: async () => !selector.includes('first_name') && !selector.includes('Register and Join'),
        click: async () => {
          clickedSelectors.push(selector);
        },
        fill: async (val) => {
          filledInputs.push({ selector, val });
        }
      })
    })
  };

  const testConfig = {
    meetingId: '987 654 321',
    passcode: 'pass123',
    attendeeName: 'Jane Doe',
    attendeeEmail: 'jane@example.com',
    screenshotsDir: os.tmpdir()
  };

  const result = await joinMeeting(mockPage, testConfig);

  assert.equal(result.success, true);
  assert.match(navigatedUrl, /^https:\/\/app\.zoom\.us\/wc\/987654321\/join\?prefer=1&pwd=/);
  assert.ok(filledInputs.some(f => f.val === 'Jane Doe'));
  assert.ok(filledInputs.some(f => f.val === 'jane@example.com'));
  assert.ok(filledInputs.some(f => f.val === 'pass123'));
  assert.ok(clickedSelectors.length >= 3);
});

