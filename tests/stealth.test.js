const test = require('node:test');
const assert = require('node:assert/strict');
const { getChromiumArgs, getUserAgent, setupStealthPage } = require('../src/stealth.js');

test('getChromiumArgs returns array with required flags', () => {
  const args = getChromiumArgs();
  assert(Array.isArray(args), 'getChromiumArgs must return an array');

  const requiredFlags = [
    '--disable-blink-features=AutomationControlled',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1920,1080',
    '--autoplay-policy=no-user-gesture-required'
  ];

  for (const flag of requiredFlags) {
    assert(args.includes(flag), `Expected args to include flag: ${flag}`);
  }
});

test('getUserAgent returns realistic non-headless Linux Chrome user agent', () => {
  const ua = getUserAgent();
  assert(typeof ua === 'string', 'getUserAgent must return a string');
  assert(ua.length > 0, 'User agent must not be empty');
  assert(ua.includes('Linux'), 'User agent must mention Linux');
  assert(ua.includes('Chrome'), 'User agent must mention Chrome');
  assert(!ua.includes('Headless'), 'User agent must not mention Headless');
});

test('setupStealthPage adds init scripts overriding navigator.webdriver, navigator.plugins, and navigator.languages', async () => {
  const scripts = [];
  const mockPage = {
    addInitScript: async (fnOrObj) => {
      scripts.push(fnOrObj);
    }
  };

  await setupStealthPage(mockPage);

  assert.equal(scripts.length >= 1, true, 'At least one init script must be added');

  // Verify mock browser environment evaluation of scripts
  const mockNavigator = {
    webdriver: true,
    languages: ['en'],
    plugins: []
  };

  // Save original descriptor of navigator on globalThis
  const originalNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: mockNavigator,
      configurable: true,
      writable: true
    });

    for (const script of scripts) {
      if (typeof script === 'function') {
        script();
      } else if (typeof script === 'object' && script.content) {
        const run = new Function(script.content);
        run();
      }
    }
  } finally {
    if (originalNavDesc) {
      Object.defineProperty(globalThis, 'navigator', originalNavDesc);
    } else {
      delete globalThis.navigator;
    }
  }

  assert.equal(mockNavigator.webdriver, false, 'navigator.webdriver should be overridden to false or undefined');
  assert(mockNavigator.languages.length >= 2, 'navigator.languages should contain realistic languages');
  assert(mockNavigator.plugins.length > 0, 'navigator.plugins should not be empty');
});
