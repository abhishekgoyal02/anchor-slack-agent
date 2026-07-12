# Anchor

Slack-native commitment tracking for teams. Anchor detects commitments in conversations, confirms them with Reality Check, creates GitHub issues, and closes the loop when work is completed.

![Anchor demo](assets/demo.gif)

## Documentation

System overview and internal architecture:

**[Anchor Architecture](architecture.md)** - Slack, Bolt JS, Reality Check, Context Snapshot, Ask Anchor, Loop Closure, GitHub, SQLite, Gemini, and MCP.

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/anchor.git
cd anchor
npm install
cp .env.sample .env
npm start
```

Fill `.env` with Slack, Gemini, and GitHub credentials before starting the app.

## Usage

1. Run Anchor in Slack Socket Mode with `npm start`.
2. Send a message that contains a clear work commitment.
3. Review the Reality Check card and confirm the commitment.
4. Anchor stores the commitment locally and creates a linked GitHub issue.
5. Ask Anchor about open work, owners, blockers, deadlines, or GitHub-linked commitments.
6. Close the GitHub issue to trigger Loop Closure back in the original Slack thread.

## Core Features

- Slack commitment detection from natural conversation.
- Reality Check confirmation before tracking work.
- Context Snapshot generation for confirmed commitments.
- GitHub issue creation and status synchronization.
- Loop Closure messages when linked issues are completed.
- Ask Anchor answers backed by local memory and MCP search tools.
- SQLite persistence for commitments and sync metadata.

## Architecture

```text
Slack
  -> Bolt JS listeners
  -> Anchor services
  -> SQLite memory
  -> GitHub issues
  -> Gemini + MCP tools
  -> Slack responses
```

Anchor keeps Slack as the user surface, SQLite as local commitment memory, GitHub as the issue tracker, and Gemini as the AI layer for analysis and assistant responses.

## Environment

Required for Socket Mode:

```bash
GOOGLE_API_KEY=YOUR_GOOGLE_API_KEY
GITHUB_TOKEN=YOUR_GITHUB_PERSONAL_ACCESS_TOKEN
GITHUB_OWNER=YOUR_GITHUB_USERNAME_OR_ORGANIZATION
GITHUB_REPO=YOUR_GITHUB_REPOSITORY
SLACK_APP_TOKEN=YOUR_SLACK_APP_TOKEN
SLACK_BOT_TOKEN=YOUR_SLACK_BOT_TOKEN
```

Optional runtime values are documented in `.env.sample`.

## Commands

```bash
npm start      # run the Slack app
npm test       # run tests
npm run lint   # run Biome checks
```

## Tech Stack

Node.js, Slack Bolt JS, Google Gemini, SQLite, GitHub REST API, MCP tools, Biome, and the Node test runner.

## License

[MIT](LICENSE)
