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

## How Anchor Works

Anchor turns informal Slack promises into trackable work without asking the team to leave the conversation.

**Reality Check** detects likely commitments and presents a confirmation card before anything is stored or sent to GitHub. It keeps tracking intentional and gives the user a final chance to accept or ignore the commitment.

**Context Snapshot** converts a confirmed commitment into a structured summary for GitHub. It captures the useful context around the work so the issue is understandable later, even outside the Slack thread.

**Ask Anchor** lets teammates ask about open work, owners, blockers, deadlines, and GitHub-linked commitments from Slack. Answers are grounded in local commitment memory through MCP search tools.

**Loop Closure** watches linked GitHub issues and posts back to the original Slack thread when work is completed. The result is a closed feedback loop from conversation to issue to completion.

**[More about anchor](https://anchor-webpage-omega.vercel.app/)** — Made with ❤️ by Abhishek Goyal

## Usage

1. Run Anchor in Slack Socket Mode with `npm start`.
2. Send a Slack message that contains a clear work commitment.
3. Review the Reality Check card and confirm the commitment.
4. Anchor stores the commitment locally and creates a linked GitHub issue.
5. Use Ask Anchor to query open work, ownership, deadlines, or blockers.
6. Close the GitHub issue to trigger Loop Closure in the original Slack thread.

## Core Features

- Natural-language commitment detection in Slack conversations.
- Reality Check confirmation before tracking work.
- Context Snapshot issue summaries for confirmed commitments.
- GitHub issue creation and status synchronization.
- Loop Closure completion messages in Slack.
- Ask Anchor responses backed by SQLite memory and MCP tools.
- Local persistence for commitments, issue links, and sync metadata.

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

[MIT](LICENSE) — Copyright (c) 2026 Abhishek Goyal
