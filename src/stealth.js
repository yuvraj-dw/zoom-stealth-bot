/**
 * Stealth utilities for Playwright browser automation
 */

function getChromiumArgs() {
  return [
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
}

function getUserAgent() {
  return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
}

async function setupStealthPage(page) {
  await page.addInitScript(() => {
    // Override navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
      configurable: true
    });

    // Override navigator.plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
      configurable: true
    });

    // Override navigator.languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
      configurable: true
    });
  });
}

module.exports = {
  getChromiumArgs,
  getUserAgent,
  setupStealthPage
};
