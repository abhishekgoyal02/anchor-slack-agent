# Project Architecture & Technical Handover Document: Anchor Slack Agent

This document provides a comprehensive technical overview and handover guide for the Anchor Slack Agent codebase. It is designed to enable any incoming software engineer to understand, maintain, debug, and expand the project without prior context.

---

## SECTION 1: PROJECT OVERVIEW

### What is Anchor?
Anchor is an AI-powered Slack Agent that bridges team communication channels with software management tools. It runs as a background daemon, monitoring Slack threads and workspaces to automatically capture commitment language, organize the details into structured schemas, verify the commitment interactively with the author, and create trackable GitHub issues.

### Problem it Solves
In software engineering team chats (e.g., Slack), developers make informal commitments daily—such as *"I'll fix the login bug by Friday"* or *"I will review that pull request after lunch"*. These commitments are frequently forgotten, overlooked, or buried in fast-moving chat histories. Anchor acts as an automated auditor that detects, tracks, and synchronizes these commitments to formal issue tracking systems.

### Main Objective
Ensure that every informal commitment made in team chat is recognized, confirmed by the owner, tracked locally, mapped to a GitHub issue, and updated when the corresponding GitHub issue is closed.

### High-Level Workflow
1. **Event Listening:** Anchor listens to Slack messages (direct messages and threads) and app mentions using the Slack Bolt SDK.
2. **Commitment Detection:** When a message is received, Anchor runs a fast local regex validator to detect commitment patterns (e.g., first-person future action verbs and timelines).
3. **AI Context Snapshot:** If a commitment is detected, Anchor invokes the Google Gemini API to classify the commitment and extract rich structured metadata (title, summary, requirements, due date, assignee, confidence, labels, complexity, and dependencies).
4. **Interactive Confirmation:** Anchor posts a Slack Block Kit confirmation card back to the original thread, presenting the extracted commitment details.
5. **Issue Creation & Storage:** If the user clicks **Confirm**, Anchor saves the commitment to a local SQLite database and invokes the GitHub REST API to create a detailed GitHub issue.
6. **Background Sync:** A background synchronization service periodically polls GitHub for the status of open linked issues. If an issue is marked as closed on GitHub, Anchor updates the local database status and posts a completion card in Slack.

### Technologies Used
- **Node.js** (v20+ ESM)
- **Slack Bolt SDK for JavaScript** (v4)
- **Google Gen AI SDK** (`@google/genai` v2.10+)
- **SQLite3**
- **Zod** (for schema validation)
- **GitHub REST API**
- **Biome** (for formatting and linting)
- **Node Test Runner** (builtin native test library)

---

## SECTION 2: FOLDER STRUCTURE

```
anchor/
├── .slack/                 # Slack CLI configuration and hook files
├── listeners/              # Slack event, action, and view controllers
│   ├── actions/            # Handles interactive UI component callbacks (e.g., button clicks)
│   ├── events/             # Listens to webhooks (messages, mentions, home tab openings)
│   └── views/              # Builders for Block Kit template blocks
├── mcp/                    # Model Context Protocol registry and tools
│   └── tools/              # Specialized executable search tools exposed to LLM
├── services/               # Core business logic layers (Gemini, GitHub, Sync, Regex)
├── storage/                # SQLite3 database engine and transaction methods
├── tests/                  # Native test suites matching file-for-file
└── thread-context/         # In-memory session stores for tracking active Slack threads
```

### Folder Interactions
- **Slack Gateway:** Incoming payloads hit `listeners/index.js` first.
- **Controller Routing:** Events are sent to `listeners/events/` and user interactions to `listeners/actions/`.
- **Business Logic Hook:** Controllers call `services/` (regex check, Gemini classification, GitHub issue generation).
- **Persistence Layer:** Services write/read data to/from the SQLite engine in `storage/`.
- **Query / LLM Protocol:** The `mcp/` directory exposes local search tools to the Gemini agent using standard Model Context Protocol, enabling the agent to search existing commitments.
- **Thread Context Store:** `thread-context/` provides temporary memory during chat cycles so that Anchor remembers which threads it is already listening to.

---

## SECTION 3: EVERY FILE IN THE PROJECT

This section catalogs every single file in the repository, explaining its purpose, responsibilities, exports, dependencies, and communication paths.

### 1. Root Configuration Files

#### `app.js`
- **Purpose:** Entry point for starting the Slack Bolt application server and syncing threads.
- **Responsibilities:** Initializes Bolt App in Socket Mode, registers listeners, starts the GitHub sync service.
- **Main Exports:** None (starts process immediately).
- **Important Functions:** Self-executing runner function.
- **Dependencies:** `@slack/bolt`, `dotenv/config`, `listeners/index.js`, `services/sync-service.js`.
- **Who calls this:** Node process (`npm start` or `node app.js`).
- **What it calls:** `App.start()`, `registerListeners()`, `startSyncService()`.
- **Input:** Environment variables.
- **Output:** Running server instances, logs.
- **Side Effects:** Binds to Socket Mode, initiates polling intervals.
- **Future Changes:** Adding server health endpoints or advanced session lifecycles.

#### `app-oauth.js`
- **Purpose:** Alternative entry point for multi-workspace installs with Slack OAuth flow.
- **Responsibilities:** Configures database state-store for installations, OAuth redirect routes, and client installation handlers.
- **Main Exports:** None.
- **Dependencies:** `@slack/bolt`, `dotenv/config`, `listeners/index.js`, `services/sync-service.js`.
- **Who calls this:** Node process manually (`node app-oauth.js`).
- **What it calls:** Bolt App constructor with OAuth options.
- **Input:** OAuth secrets, client credentials, redirects.
- **Output:** Running HTTP server on port 3000.
- **Side Effects:** SQLite database connection for installation store.
- **Future Changes:** Scaling Anchor into a multi-tenant SaaS.

#### `package.json`
- **Purpose:** Standard Node module definitions, dependencies, and build scripts.
- **Dependencies:** `@google/genai`, `@slack/bolt`, `sqlite3`, `zod`, `@biomejs/biome`, `typescript`.
- **Scripts:** `start` (runs app.js), `test` (runs tests), `lint` (runs Biome check).

#### `manifest.json`
- **Purpose:** Slack Application definition descriptor.
- **Responsibilities:** Declares scopes (`app_mentions:read`, `chat:write`, `im:history`, `im:write`, `metadata.message:read`), Socket Mode requirement, and events subscription setup.

#### `biome.json`
- **Purpose:** Configures the Biome linter, parser, and formatter style rules.

#### `.env.sample`
- **Purpose:** Template containing all required API keys and configuration parameters.

#### `.gitignore`
- **Purpose:** Directs Git to ignore transient directories (`node_modules`, SQLite `.db` binaries, `.env`).

---

### 2. Slack Listeners (`listeners/`)

#### `listeners/index.js`
- **Purpose:** Master registry interface for Slack Bolt event listeners.
- **Responsibilities:** Exposes a single registration hook to register action, event, and view handlers.
- **Main Exports:** `registerListeners(app)`.
- **Who calls this:** `app.js` and `app-oauth.js`.
- **What it calls:** `actions.register()`, `events.register()`, `views.register()`.

#### `listeners/actions/index.js`
- **Purpose:** Controller routing for interactive user clicks.
- **Responsibilities:** Registers handler functions for Bolt action triggers (`feedback`, `commitment_confirm`, `commitment_ignore`).
- **Main Exports:** `register(app)`.

#### `listeners/actions/commitment-buttons.js`
- **Purpose:** Execution handler for confirmation card buttons.
- **Responsibilities:**
  - `handleCommitmentConfirm`: Handles commitment confirmation. Parses the structured JSON payload, queries Slack user details, stores commitment records in SQLite, creates a GitHub issue, and updates the Slack thread block layout to confirmed state.
  - `handleCommitmentIgnore`: Updates the Slack card to an ignored layout without saving to SQLite or GitHub.
- **Main Exports:** `handleCommitmentConfirm`, `handleCommitmentIgnore`.
- **Dependencies:** `services/github-service.js`, `storage/commitment-store.js`, `listeners/views/commitment-card.js`.
- **Input:** User interaction payload.
- **Output:** Bolt payload update response, database inserts.
- **Side Effects:** Writes SQLite record, fires POST request to GitHub API, updates Slack interface.

#### `listeners/actions/feedback-buttons.js`
- **Purpose:** Handler for Slack assistant feedback options.
- **Responsibilities:** Listens for feedback responses on streamed chat responses.
- **Main Exports:** `handleFeedbackButton`.

#### `listeners/events/index.js`
- **Purpose:** Controller routing for Slack events subscriptions.
- **Responsibilities:** Directs callbacks for events (`app_home_opened`, `app_mention`, `assistant_thread_started`, `message`).
- **Main Exports:** `register(app)`.

#### `listeners/events/message.js`
- **Purpose:** Event controller for standard Slack messages.
- **Responsibilities:** Filters messages (ignores bot postings, checks channel types). Triggers fast regex validation; if matching, triggers confirmation card flow. If inside an active assistant thread, passes the prompt to Gemini chat.
- **Main Exports:** `handleMessage`.
- **Dependencies:** `services/commitment-detector.js`, `services/gemini-service.js`, `thread-context/index.js`, `listeners/events/conversation-response.js`.
- **Who calls this:** Slack Event Hook gateway.
- **Input:** message event schema.
- **Side Effects:** Updates active session memory state.

#### `listeners/events/app-mentioned.js`
- **Purpose:** Event controller for Slack app mentions (`@Anchor`).
- **Responsibilities:** Processes mentions in public channels. Runs regex detector; if a commitment is present, presents a card. Otherwise, routes text to Gemini chat for responses.
- **Main Exports:** `handleAppMentioned`.

#### `listeners/events/app-home-opened.js`
- **Purpose:** Configures Bolt listener for App Home screen.
- **Responsibilities:** Triggers rendering of Bolt views for the user's home screen.
- **Main Exports:** `handleAppHomeOpened`.

#### `listeners/events/assistant-thread-started.js`
- **Purpose:** Listener that triggers when an assistant workspace thread starts.
- **Responsibilities:** Automatically pushes standard user starter prompts.
- **Main Exports:** `handleAssistantThreadStarted`.

#### `listeners/events/conversation-response.js`
- **Purpose:** Slack assistant response engine utilities.
- **Responsibilities:**
  - `setThinkingStatus`: Shows a customized rotating loading state.
  - `postCommitmentCard`: Classifies messages using Gemini and streams the structured Block Kit confirmation card.
  - `streamAssistantResponse`: Appends markdown and shows thumbs up/down feedback components.
- **Main Exports:** `postCommitmentCard`, `setThinkingStatus`, `streamAssistantResponse`.
- **Dependencies:** `services/gemini-service.js`, `listeners/views/commitment-card.js`, `listeners/views/feedback-builder.js`.

#### `listeners/views/index.js`
- **Purpose:** Bolt Views registry route index.
- **Responsibilities:** Stub registry file for view interactions.
- **Main Exports:** `register(app)`.

#### `listeners/views/commitment-card.js`
- **Purpose:** Slack Block Kit block UI engine for commitment states.
- **Responsibilities:**
  - `buildCommitmentCard`: Builds the pre-confirmation card layout showing the extracted title, summary, due date, requirements, and mapped confidence label. Sets the Confirm/Ignore payload values as JSON string.
  - `buildCommitmentConfirmedCard`: Constructs the confirmed layout showing local status and GitHub issue links.
  - `buildCommitmentAlreadyTrackedCard`: Constructs the duplicate state layout.
  - `buildCommitmentIgnoredCard`: Constructs the ignored state layout.
  - `buildCommitmentCompletedCard`: Constructs the synced completed state layout.
- **Main Exports:** `buildCommitmentCard`, `buildCommitmentConfirmedCard`, `buildCommitmentAlreadyTrackedCard`, `buildCommitmentIgnoredCard`, `buildCommitmentCompletedCard`.

#### `listeners/views/app-home-builder.js`
- **Purpose:** Block Kit builder UI layouts for App Home tab.
- **Main Exports:** `buildAppHomeView`.

#### `listeners/views/feedback-builder.js`
- **Purpose:** Block Kit UI builder for feedback components.
- **Main Exports:** `buildFeedbackBlocks`.

---

### 3. Core Business Services (`services/`)

#### `services/commitment-detector.js`
- **Purpose:** First-pass deterministic regex commitment detector.
- **Responsibilities:** Executes rapid validation using starter patterns (e.g. *I'll, I will, let's, we will*), action verbs (e.g. *fix, deploy, write, investigate*), timelines, and direct targets.
- **Main Exports:** `detectCommitment(text)`.
- **Called by:** Message and Mention listeners.
- **Input:** message text string.
- **Output:** boolean value indicating if a potential commitment is present.
- **Side Effects:** None (pure functional parsing).

#### `services/commitment-dto.js`
- **Purpose:** DTO translator for mapping SQLite data rows to public MCP JSON contracts.
- **Responsibilities:** Formats dates, status labels (Open, In Progress, Completed, Blocked, Archived), and Slack mentions.
- **Main Exports:** `toCommitmentDto`, `formatCommitmentStatus`, `formatHumanDate`, `formatSlackMention`.
- **Dependencies:** Standard Intl formatting.

#### `services/commitment-search-service.js`
- **Purpose:** Database fuzzy text query wrapper.
- **Responsibilities:** Queries local database for queries and formats output rows using DTO maps.
- **Main Exports:** `searchCommitments(input, deps)`.
- **Dependencies:** `storage/commitment-store.js`, `services/commitment-dto.js`.
- **Who calls this:** Search commitments MCP tool registry.

#### `services/gemini-service.js`
- **Purpose:** Main integration wrapper for the Google Gemini API.
- **Responsibilities:**
  - Configures the Gemini SDK client instance.
  - `generateText`: Handles raw text prompts.
  - `generateTextWithTools`: Orchestrates function calling using registered MCP search tools.
  - `classifyCommitment`: Calls Gemini with `responseMimeType: 'application/json'` and schema definitions to analyze commitments and output structured JSON data.
- **Main Exports:** `GeminiService`, `generateResponse`, `classifyCommitment`, `getDefaultGeminiService`.
- **Dependencies:** `@google/genai`, `mcp/index.js`, `mcp/logger.js`.
- **Called by:** Slack event controllers.

#### `services/github-service.js`
- **Purpose:** GitHub REST API integrations.
- **Responsibilities:**
  - `createIssue`: Invokes issue creation on GitHub with structured markdown formatting.
  - `getIssue`: Polls issue state from GitHub repository.
  - `formatIssueTitle`: Formats issue titles.
  - `formatIssueBody`: Formats issue bodies using the structured commitment metadata.
- **Main Exports:** `createIssue`, `getIssue`, `formatIssueTitle`, `formatIssueBody`.
- **Dependencies:** Fetch client.
- **Called by:** Confirmation action buttons, status sync service.

#### `services/sync-service.js`
- **Purpose:** Synchronization task daemon.
- **Responsibilities:**
  - Periodically polls SQLite for open commitments.
  - Fetches matching GitHub issues.
  - If closed on GitHub, updates local status to `completed` and posts a completion card in Slack.
- **Main Exports:** `syncGitHubIssueStatuses`, `startSyncService`.
- **Dependencies:** `storage/commitment-store.js`, `services/github-service.js`, `listeners/views/commitment-card.js`.
- **Who calls this:** `app.js` and `app-oauth.js` during startup.

---

### 4. Storage Engine (`storage/`)

#### `storage/commitment-store.js`
- **Purpose:** SQLite3 database models and lifecycle operations.
- **Responsibilities:**
  - Lazy initialization of SQLite database schema (`commitments.db`).
  - Migration checks for columns (`github_issue_number`, `github_issue_url`, `completed_at`, `message_ts`).
  - Implements operations: `saveCommitment`, `updateCommitmentGithubMetadata`, `markCommitmentCompleted`, `getCommitmentById`, `getAllOpenCommitments`, `getOpenCommitmentsWithGithubIssues`, `findCommitmentsByText`, `findOpenCommitmentByThreadAndText`.
- **Main Exports:** All DB action functions.
- **Dependencies:** `sqlite3`.
- **Side Effects:** Writes to local SQLite file system.

---

### 5. Memory State Store (`thread-context/`)

#### `thread-context/index.js`
- **Purpose:** Singleton context store initialization.
- **Main Exports:** `sessionStore`.

#### `thread-context/store.js`
- **Purpose:** In-memory session store.
- **Responsibilities:** Maps Slack channel and thread timestamps to active session IDs, enforcing TTL expiration policies and evicting old entries.
- **Main Exports:** `SessionStore`.

---

### 6. Model Context Protocol (`mcp/`)

#### `mcp/index.js`
- **Purpose:** Configures and registers tools to the Anchor MCP server.
- **Main Exports:** `createAnchorMcpServer`.
- **Dependencies:** `mcp/server.js`, `mcp/registry.js`, `mcp/tools/search-commitments.js`.

#### `mcp/logger.js`
- **Purpose:** Standardized MCP output interface.
- **Main Exports:** `silentMcpLogger`.

#### `mcp/registry.js`
- **Purpose:** Enforces registry contracts for MCP tools.
- **Responsibilities:** Validates that registered tools specify schema name, description, category, inputs, outputs, and an execute hook.
- **Main Exports:** `ToolRegistry`.

#### `mcp/server.js`
- **Purpose:** MCP request execution framework.
- **Responsibilities:** Listens for calls, validates input parameters using Zod schemas, executes tools, and logs execution telemetry.
- **Main Exports:** `AnchorMcpServer`, `toDiscoverySchema`.

#### `mcp/tools/search-commitments.js`
- **Purpose:** MCP search tool implementation.
- **Responsibilities:** Exposes local SQLite searches to Gemini as an executable search tool.
- **Main Exports:** `createSearchCommitmentsTool`.

---

### 7. Unit Tests (`tests/`)

Every JavaScript file has a matching test script in the `tests/` directory verifying its implementation details using native Node.js asserts and mocks.

- **`tests/listeners/events/app-home-opened.test.js`**
- **`tests/listeners/events/conversation-response.test.js`**
- **`tests/listeners/events/message.test.js`**
- **`tests/listeners/views/app-home-builder.test.js`**
- **`tests/listeners/views/commitment-card.test.js`**
- **`tests/listeners/views/feedback-builder.test.js`**
- **`tests/mcp/registry.test.js`**
- **`tests/mcp/server.test.js`**
- **`tests/mcp/tools/search-commitments.test.js`**
- **`tests/services/commitment-detector.test.js`**
- **`tests/services/commitment-dto.test.js`**
- **`tests/services/commitment-search-service.test.js`**
- **`tests/services/gemini-service.js`**
- **`tests/services/github-service.test.js`**
- **`tests/services/sync-service.test.js`**
- **`tests/storage/commitment-store.test.js`**
- **`tests/thread-context/store.test.js`**

---

## SECTION 4: APPLICATION RUNTIME FLOW

The flow of a Slack message through Anchor's pipelines is structured as follows:

```
[Slack Message] ──> [message event listener]
                         │
                         ▼
             [detectCommitment() Regex] ── (False) ──> [Gemini Chat Response] ──> [Slack]
                         │
                      (True)
                         │
                         ▼
             [classifyCommitment() Gemini JSON]
                         │
                         ▼
             [buildCommitmentCard() Block Kit] ──> [Slack Thread Confirmation Card]
                         │
                 (User clicks Confirm)
                         │
                         ▼
             [handleCommitmentConfirm()]
                ├── [users.info] ──> (Assignee Slack display name resolved)
                ├── [saveCommitment()] ──> [SQLite commitments.db]
                └── [createIssue()] ──> [GitHub API]
                         │
                         ▼
             [chat.update] ──> [Slack Thread Updated to Tracked]
```

### Flow Execution Details
1. **Trigger:** A user posts a message. The `message` listener intercepts it.
2. **Regex Filter:** `detectCommitment(text)` performs high-speed local processing. If not matched, it defaults to a standard assistant response.
3. **Structured Enrichment:** If matched, Gemini analyses the commitment and extracts the structured metadata schema.
4. **Slack Interaction:** Block Kit displays the card with `Confirm` and `Ignore` actions.
5. **Database Transaction:** The user clicks **Confirm**. Bolt receives the payload and resolves the author's Slack display name. It then stores the commitment in SQLite.
6. **GitHub Issue:** Anchor posts a formatted markdown payload to the GitHub API, retrieves the issue number and URL, updates the SQLite row with the metadata, and updates the Slack interface.

---

## SECTION 5: DATABASE ARCHITECTURE

Anchor uses SQLite for local persistence, saving records inside a `commitments.db` file database.

### Table: `commitments`
Houses all commitments captured and synchronized.

| Column | Data Type | Modifiers | Purpose |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique record ID. |
| `text` | TEXT | NOT NULL | Original raw Slack message string. |
| `user_id` | TEXT | NOT NULL | Author's Slack User ID. |
| `channel_id` | TEXT | NOT NULL | Originating Slack Channel ID. |
| `thread_ts` | TEXT | NOT NULL | Thread Timestamp (grouping key). |
| `message_ts` | TEXT | | Timestamp of the specific confirmation card. |
| `status` | TEXT | DEFAULT 'open' | Lifecycle state (`open`, `completed`, etc.). |
| `created_at` | TEXT | DEFAULT (datetime('now')) | UTC creation timestamp. |
| `github_issue_number` | INTEGER | | Mapped issue identifier on GitHub. |
| `github_issue_url` | TEXT | | Link to the GitHub issue. |
| `completed_at` | TEXT | | Timestamp when the linked issue was closed. |

### Lifecycle of a Database Row
1. **Creation:** Inserted when a user clicks **Confirm** inside `handleCommitmentConfirm()`.
2. **Linked Metadata:** Updated when the GitHub REST API successfully responds with `issueNumber` and `issueUrl`.
3. **Status Sync:** Periodically evaluated by `syncGitHubIssueStatuses()`. If the issue state is resolved as `closed` on GitHub, `status` is updated to `completed` and `completed_at` is set.

---

## SECTION 6: MODEL CONTEXT PROTOCOL (MCP) SERVER

Anchor implements an in-memory Model Context Protocol (MCP) server that exposes local workspace state to the LLM agent during tool-calling cycles.

### Architecture

```
[Gemini LLM] ── (Request search) ──> [AnchorMcpServer]
                                          │
                                          ▼
                                   [ToolRegistry]
                                          │
                                   [search_commitments]
                                          │
                                          ▼
                                [commitmentSearchService]
                                          │
                                          ▼
                                     [SQLite DB]
```

### Components
- **`ToolRegistry`:** Validates that tool specifications meet name, description, schema inputs, and callback contracts.
- **`AnchorMcpServer`:** Directs invocation requests. Validates inputs against Zod schemas, executes the tool callback, captures duration telemetry, logs output, and formats results.
- **`search_commitments` Tool:**
  - **Inputs:** `query` (Fuzzy text query string).
  - **Outputs:** Mapped array of commitments showing Title, Status, Assignee, Creation Timestamp, and GitHub Issue reference.
- **Gemini Integration:** During assistant interaction, Gemini evaluates the prompt against available MCP tools. If matching, Gemini executes the tool call, processes database output, and replies to the Slack thread in natural language.

---

## SECTION 7: CORE SERVICES LAYERS

### `GeminiService`
- **Responsibilities:** Direct connection to the Google Gemini API client. Wraps SDK calls, manages message history, and configures tool-calling parameters.
- **Error Handling:** Catches API faults and maps them to `GeminiServiceError` logs to avoid exposing credentials.

### `GitHubService`
- **Responsibilities:** Communicates with GitHub's REST API. Generates titles and markdown bodies.
- **Error Handling:** Translates non-2xx API responses into distinct `GitHubServiceError` exceptions.

### `SyncService`
- **Responsibilities:** Runs a background synchronization cycle that monitors open GitHub issues. Ensures local SQLite state aligns with GitHub issues.

---

## SECTION 8: SLACK BOLT INTEGRATION

- **Socket Mode:** The application uses Socket Mode to establish web socket channels with Slack, removing the need for public endpoint exposing.
- **Block Kit Layouts:** Rendered components use standard sections, action buttons, context fields, and text configurations.
- **Streaming Responses:** Assistant replies stream updates to the user in real time.
- **Thread Context Store:** Tracks active threads to maintain context across conversational interactions.

---

## SECTION 9: GITHUB INTEGRATION

- **Authentication:** Authenticates requests using a GitHub Personal Access Token (PAT) passed via authorization headers.
- **REST Endpoints:** Uses `/repos/{owner}/{repo}/issues` to create and fetch issues.
- **Synchronization Poller:** A background daemon checks issue statuses, updating Slack when issues are closed.

---

## SECTION 10: GOOGLE GEMINI INTEGRATION

- **Model:** Default configured model is `gemini-2.5-flash`.
- **System Instructions:** Sets instructions instructing Gemini how to format answers and mention users.
- **Tool Calling:** Employs recursive tool-calling routines to gather local context via MCP tools before producing responses.

---

## SECTION 11: TESTING ARCHITECTURE

Anchor's test suite uses Node's native test runner (`node --test`), providing fast executions with zero external testing dependencies.

- **Structure:** Located in `tests/` mirrors the source folder structure.
- **Mocking Strategy:** Uses mock clients to simulate external APIs (Slack, Google Gemini, GitHub) and prevent network hits.
- **Database Isolation:** Tests initialize in-memory SQLite instances to run database transactions without modifying the local `commitments.db` file.

---

## SECTION 12: ENVIRONMENT VARIABLES

| Variable | Description | Required | Default Value |
| :--- | :--- | :--- | :--- |
| `GOOGLE_API_KEY` | Google Gemini API Authorization Key. | **Yes** | None |
| `GEMINI_MODEL` | Gemini LLM model name. | No | `gemini-2.5-flash` |
| `GITHUB_TOKEN` | GitHub PAT for REST API calls. | **Yes** | None |
| `GITHUB_OWNER` | Target GitHub Username or Organization. | **Yes** | None |
| `GITHUB_REPO` | Target GitHub Repository. | **Yes** | None |
| `SLACK_BOT_TOKEN` | Slack Bot OAuth Credential. | **Yes** | None |
| `SLACK_APP_TOKEN` | Slack App-Level Socket Mode Token. | **Yes** | None |
| `SYNC_INTERVAL_MS` | GitHub polling frequency in milliseconds. | No | `300000` (5 mins) |
| `DATABASE_PATH` | Path to local commitments SQLite database file. | No | `storage/commitments.db` |

---

## SECTION 13: PACKAGE DEPENDENCIES

- **`@google/genai`:** Google's SDK for Gemini API access.
- **`@slack/bolt`:** Framework to build Slack integrations.
- **`sqlite3`:** SQLite database wrapper.
- **`zod`:** Schema validation library.
- **`dotenv`:** Loads environment variables.

---

## SECTION 14: COMPLETED FEATURES

- **Slack Assistant:** Conversational agent that responds to mentions.
- **Regex Commitment Detection:** High-speed pattern recognition.
- **Interactive confirmation Card:** User confirmation workflow.
- **GitHub Issue Creation:** Automated ticket logging.
- **SQLite Database Store:** Local commitment tracking.
- **MCP Server:** Local workspace tools for the LLM.
- **Gemini Tool Calling:** LLM tool integration.
- **Sync Services:** GitHub status monitoring.

---

## SECTION 15: KNOWN LIMITATIONS

- **Thread context Ephemerality:** In-memory store resets on server restarts.
- **Fuzzy Search Scope:** SQLite queries use simple SQL `LIKE` statements instead of advanced vector embeddings.

---

## SECTION 16: FUTURE FEATURE PLAN

### 1. Context Snapshot
- **Proposed Objective:** Enrich detected commitments with detailed metadata (title, summary, requirements, due date, assignee, confidence, complexity, labels, and dependencies) before confirmation.
- **Implementation Strategy:**
  - Call Gemini when `detectCommitment()` returns `true`.
  - Save the full serialized metadata JSON inside a new SQLite column.
  - Render these metadata fields on the confirmation card and use them to construct detailed GitHub issues.

### 2. Loop Closure
- **Proposed Objective:** Notify users when commitments are completed.
- **Implementation Strategy:** Let `sync-service.js` update Slack channels with the completed state when issues are closed on GitHub.

### 3. Ask Anchor
- **Proposed Objective:** Answer questions about commitments in natural language.
- **Implementation Strategy:** Leverage the MCP server tools to search and retrieve commitments, letting the LLM synthesize answers.

### 4. Reality Check
- **Proposed Objective:** Estimate feasibility and dependency risks.
- **Implementation Strategy:** Analyze commitment metadata (complexity, dependencies) to flag overall scheduling risks.

### 5. Team Snapshot
- **Proposed Objective:** Aggregate commitments across teams.
- **Implementation Strategy:** Query commitments and group them by status and assignee.

---

## SECTION 17: ASCII FLOW DIAGRAMS

### Overall Architecture
```
+-------------------------------------------------------------+
|                        Slack Bolt                           |
|  +--------------------+             +--------------------+  |
|  |  Event Listener    |             |   Action Handler   |  |
|  +---------+----------+             +---------+----------+  |
+------------|----------------------------------|-------------+
             |                                  |
             v                                  v
  +--------------------+              +--------------------+
  | CommitmentDetector |              |   GitHub Service   |
  +---------+----------+              +---------+----------+
             |                                  |
             v                                  v
  +--------------------+              +--------------------+
  |   Gemini Service   |              |  Commitment Store  |
  +--------------------+              +---------+----------+
             |                                  |
             v                                  v
  +--------------------+              +--------------------+
  |     MCP Tools      |              |   SQLite database  |
  +--------------------+              +--------------------+
```

### Search Flow
```
[User Chat Prompt] ---> [Gemini LLM Engine]
                              │
                      (Search Request)
                              │
                              ▼
                      [AnchorMcpServer]
                              │
                              ▼
                      [ToolRegistry]
                              │
                              ▼
                    [search_commitments]
                              │
                              ▼
                 [commitmentSearchService]
                              │
                              ▼
                     [SQLite DB Query]
```

---

## SECTION 18: FILE DEPENDENCY MAP

```
      app.js
        │
        ├──> listeners/index.js
        │      │
        │      ├──> listeners/events/index.js
        │      │      ├──> app-mentioned.js ──> conversation-response.js ──> gemini-service.js
        │      │      └──> message.js ────────> commitment-detector.js
        │      │
        │      └──> listeners/actions/index.js
        │             └──> commitment-buttons.js
        │                    ├──> github-service.js
        │                    └──> storage/commitment-store.js
        │
        └──> services/sync-service.js
               ├──> storage/commitment-store.js
               └──> services/github-service.js
```

---

## SECTION 19: EXECUTION ORDER

1. **User Sends Slack Message:**
   - Evaluated by `message.js` or `app-mentioned.js`.
2. **Commitment Detected:**
   - Triggers `detectCommitment()`.
   - Calls `classifyCommitment()` to extract structured JSON.
   - Renders confirmation card via `buildCommitmentCard()`.
3. **User Confirms:**
   - `handleCommitmentConfirm()` triggers.
   - Resolves assignee name using `users.info`.
   - Saves record to SQLite using `saveCommitment()`.
4. **GitHub Issue Created:**
   - Invokes `createIssue()`.
   - Formats body using `formatIssueBody()`.
   - Updates database row with issue metadata.
   - Updates Slack card to confirmed status.
5. **Search Requested:**
   - Gemini handles search requests using the `search_commitments` tool.

---

## SECTION 20: SUMMARY

This document serves as the master architectural handbook for Anchor. The codebase uses modern ES modules, clean separations of concerns, native Node.js test runner suites, Socket Mode configurations, local SQLite persistence, Model Context Protocol tools, and Google Gemini API services. It is designed to be fully extensible to support upcoming commitment analytics features.
