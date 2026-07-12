# Anchor Architecture

Anchor is a Slack-first application for detecting, tracking, and closing the loop on work commitments.

## System Overview

```text
Slack
  -> Bolt JS app
  -> listeners
  -> services
  -> SQLite memory
  -> GitHub integration
  -> Gemini / MCP tools
  -> Slack responses
```

Slack is the user surface. Users interact with Anchor through messages, mentions, assistant threads, and commitment confirmation cards.

The Bolt JS app is the server boundary. `app.js` runs the Socket Mode app for local Slack operation, while `app-oauth.js` supports an OAuth-based HTTP mode.

## Main Pieces

- **Slack listeners** receive events, route messages, render cards, and handle button actions.
- **Commitment detection** checks Slack messages for likely commitments before any tracking flow starts.
- **Reality Check** analyzes a detected commitment and builds the confirmation card shown in Slack.
- **Context Snapshot** creates structured context for confirmed commitments before they are sent to GitHub.
- **GitHub integration** creates issues and reads issue state for synced commitments.
- **Loop Closure** watches linked GitHub issues and posts back to Slack when work is completed.
- **Ask Anchor** answers work-related questions using Gemini and local commitment search tools.
- **Database / memory** uses SQLite to persist commitments, GitHub links, status, and sync metadata.
- **AI / LLM layer** uses Google Gemini for analysis, generated responses, and tool-calling through the internal MCP boundary.
- **MCP tools** expose local commitment search to the LLM without giving the model direct storage access.

## Flow

1. A Slack message reaches the Bolt app.
2. Listeners route the message through commitment detection or assistant response handling.
3. If a commitment is detected, Reality Check prepares a Slack confirmation card.
4. When confirmed, Anchor stores the commitment in SQLite.
5. Context Snapshot prepares GitHub issue content.
6. The GitHub service creates or updates the linked issue.
7. Loop Closure polls GitHub issue state and reports completed work back to Slack.
8. Ask Anchor uses Gemini and MCP search tools to answer questions from stored commitment memory.

## Data Boundaries

SQLite is the source of truth for local commitment memory. GitHub is the external issue tracker. Slack is the interaction layer.

Gemini does not write directly to storage or GitHub. It receives structured context through services and MCP tools, then returns analysis or response text for Anchor to use.
