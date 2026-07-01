# Anchor

Anchor is a Slack Bolt application that uses Google Gemini for AI responses, detects commitments in Slack conversations, stores commitments in SQLite, creates GitHub issues, and keeps Slack messages in sync with GitHub issue status.

Gemini is the only AI provider used by this project.

## App Overview

Anchor supports these Slack entry points:

* **App Home** - Displays a welcome message.
* **Direct Messages** - Responds to user messages in Slack DMs.
* **Channel @mentions** - Responds in thread when mentioned in a channel.
* **Assistant Panel** - Provides suggested prompts for Slack assistant threads.
* **Confirmation Cards** - Shows commitment confirmation cards before creating GitHub issues.

## Environment

Create `.env` from `.env.sample` and configure the values needed for your runtime.

Required Gemini configuration:

```sh
GOOGLE_API_KEY=YOUR_GOOGLE_API_KEY
GEMINI_MODEL=gemini-2.5-flash
```

Slack Socket Mode configuration:

```sh
SLACK_APP_TOKEN=YOUR_SLACK_APP_TOKEN
SLACK_BOT_TOKEN=YOUR_SLACK_BOT_TOKEN
```

GitHub issue creation and sync configuration:

```sh
GITHUB_TOKEN=YOUR_GITHUB_PERSONAL_ACCESS_TOKEN
GITHUB_OWNER=YOUR_GITHUB_OWNER
GITHUB_REPO=YOUR_GITHUB_REPOSITORY
SYNC_INTERVAL_MS=300000
```

OAuth HTTP mode is available through `app-oauth.js` when Slack app distribution is needed. Configure the optional OAuth values shown in `.env.sample`.

## Development

Install dependencies:

```sh
npm install
```

Start the Socket Mode app:

```sh
npm start
```

Run tests:

```sh
npm test
```

Run Biome:

```sh
npm run lint
```

## Project Structure

* `app.js` - Socket Mode Slack app entry point.
* `app-oauth.js` - Optional HTTP/OAuth Slack app entry point.
* `listeners/` - Slack event, action, and view listeners.
* `services/gemini-service.js` - Gemini client wrapper and text generation helper.
* `services/commitment-detector.js` - Commitment detection.
* `services/github-service.js` - GitHub issue operations.
* `services/sync-service.js` - GitHub to Slack status sync.
* `storage/commitment-store.js` - SQLite persistence.
* `thread-context/` - Thread participation tracking.
* `tests/` - Node test suite.
