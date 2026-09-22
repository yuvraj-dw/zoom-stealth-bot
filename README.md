# zoom-stealth-bot

An automated Zoom meeting and webinar attendee daemon using Playwright, Telegram bot commands, and Google Gemini for meeting Q&A summarization.

![zoom-stealth-bot Demo](docs/demo.gif)

---

## Features

- **Browser stealth**: Removes automation flags (`navigator.webdriver`), configures realistic plugins, WebGL profiles, and user agents to avoid bot blocks.
- **Webinar token joining**: Supports direct registration tokens (`tk=...`) to avoid registration screens and reCAPTCHA Enterprise challenges.
- **Telegram bot control**:
  - `/status` - Check current connection status and session duration.
  - `/screenshot` (or `/ss`) - Capture a current screenshot of the presentation.
  - `/summary` - Extract live Q&A and chat from Zoom's internal state and generate a structured summary.
  - `/join` - Start and join the meeting immediately.
  - `/leave` - Disconnect, capture a final summary, and close the browser.
  - `/help` - List available commands.
- **Meeting summarization**: Reads mentor answers, announcements, and links from Zoom's client state, then parses them via Gemini models with automatic fallback.
- **Scheduler**: Configurable timer to join recurring sessions automatically.
- **Docker deployment**: Multi-stage Docker container with headless Chromium preconfigured.

---

## Architecture

```
Telegram User -> Telegram Bot (Polling Daemon)
                      |
        +-------------+-------------+
        |                           |
Manual Commands (/join, /ss)  Scheduled Timer
        |                           |
        +-------------+-------------+
                      |
        SessionController (Playwright)
                      |
        +-------------+-------------+
        |             |             |
   Stealth Page  React Fiber    Gemini API
 (Bypass Checks) (Feed Scrape) (Summaries)
        |             |             |
        +-------------+-------------+
                      |
            Telegram Notifications
```

---

## Getting Started

### 1. Clone and Configure

```bash
git clone https://github.com/yuvraj-dw/zoom-stealth-bot.git
cd zoom-stealth-bot
cp .env.example .env
```

Edit your `.env` configuration file:

```ini
ZOOM_MEETING_ID=1234567890
ZOOM_PASSCODE=123456
ATTENDEE_NAME="Your Name"
ATTENDEE_EMAIL=you@example.com

# Optional: Webinar registration token (from your join link)
ZOOM_WEBINAR_TOKEN=

# Google Gemini API key and model for meeting summaries
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.6-flash

# Telegram notifications and control
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ
TELEGRAM_CHAT_ID=123456789
```

### 2. Run with Docker (Recommended)

Build and run using Docker Compose:

```bash
docker compose up -d --build
```

View live logs:

```bash
docker compose logs -f
```

### 3. Run Locally (Node.js 18+)

```bash
npm install
npx playwright install chromium
npm start
```

Run test suite:

```bash
npm test
```

---

## Telegram Bot Commands

| Command | Description |
| :--- | :--- |
| `/status` | Check if currently connected to a meeting and elapsed time |
| `/screenshot`, `/ss` | Get an instant screenshot of the live meeting |
| `/summary` | Generate a summary of mentor Q&A, answers, and shared links |
| `/join` | Launch browser and join meeting |
| `/leave` | Leave the meeting, generate final summary, and close browser |
| `/help` | Show command help menu |

---

## Security and Privacy

- Configuration values and tokens are loaded strictly through environment variables.
- Passwords and webinar tokens should remain private and never be committed to git.

---

## License

MIT (c) Zoom Attendee Bot Contributors
