# PLAN — Coding agents on the user's machine: prompts in a terminal, categorization headless

**Status:**
- **Written:** 2026-09-17.
- **Built 2026-09-17:** Step 0, Part A's Steps A1–A2 and A3's docs, and Part B's Steps
  B1–B4. See the progress log (§6).
- **Changed 2026-09-17, after the build:** one coding agent, chosen in Settings, now runs
  everything AI; this supersedes §3.2 decision 9 and §4.2 decisions 1–3 (see the last log
  entry).
- **Changed 2026-09-17, later:** each agent's models are checked at startup, with a floor of
  Claude Sonnet / GPT-5.6 Terra, and prompts open in auto mode; this supersedes §3.2
  decisions 1 and 11 and the categorization models in the log (see the last log entry).
- **Changed 2026-09-17, later still:** a legibility review moved every module named in this
  plan into `packages/api/coding-agent/` and changed the shapes it describes — see
  "Where this plan's code lives now" below. The decisions still hold; the paths and a few
  contract fields don't.
- **Next:** A3's hands-on terminal checks on macOS (an owner's check: they open real
  terminal windows and need someone to answer the agent), then the follow-ups in §5 and §6.

This file stands on its own. A coding agent should be able to pick up any step using only
this file, the dbu6 repository, and the Nuabase checkout named in §1.4. You don't need the
conversation that produced it.

**Where this plan's code lives now.** `packages/api/coding-agent.ts`, `coding-agent-models.ts`,
`llm-engine.ts` and `agent-handoff/launcher.ts` are gone; their contents are in
`packages/api/coding-agent/` (`agents.ts`, `models.ts`, `nuabase.ts`, `categorization-llm.ts`,
`handoff.ts`, `launcher.ts`, `errors.ts`, `settings.ts`). Each agent's models and auto-mode
options are one table, `CODING_AGENT_RUN` in `agents.ts`; its name and sign-in command are
`CODING_AGENTS` in `dbu6-shared`. `nuabase.ts` is the only module that imports `nuabase`.
The handoff contract now answers with how a prompt would be handed off
(`{ mode: "none" | "terminal" | "command" }`) and what the server did with it
(`{ agent, mode, … }`), instead of capabilities the browser posts back; the categorization
report names an `agent` rather than an engine, and an import that created no drafts has
none. See DEVELOPMENT.md's "LLM engine".

---

## 0. How to use this plan (read first)

1. **Find your step** (§2, §3.4, §4.4) and check its **Prerequisites**. If one isn't done,
   stop and ask the project owner.
2. **Read §1 before touching code**, then the section for your part.
3. **Load the `sapporta` agent skill** before changing the API or the UI (see `AGENTS.md`).
   Follow `CODING-PRINCIPLES.md`.
4. **No personal data** in tests, fixtures, docs or comments. Use the `050505` / `NOPII` /
   `sample` conventions in `AGENTS.md`.
5. **Never test against the owner's `data/`.** Run `pnpm seed` against a scratch
   `SAPPORTA_DATA_DIR` and scratch ports.
6. **Keep this file current.** Tick checkboxes as you finish tasks. Add an entry to the
   progress log (§6) with the date, the step, what changed, and any deviations or findings.
   Correct this plan if the code disagrees with it.
7. **Stay in scope.** List follow-ups in the progress log instead of doing them.

---

## 1. Goal and background

### 1.1 dbu6

dbu6 is a self-hosted double-entry bookkeeping app for personal finances, built on Sapporta
(`packages/api` is a Hono server, `packages/frontend` a React SPA, `packages/shared` the
ts-rest contracts they share). It imports bank and card statements as *drafts*, categorizes
them, checks balances, and posts them to the books.

The app's API is mounted in `packages/api/app.ts` (`loadApp`). Each sub-app lives in
`packages/api/app/*.ts` and implements a contract from `packages/shared/src/contracts/`.
The frontend calls it through clients created in `packages/frontend/src/api.ts`.
`requireWorkflowAuth(c)` (`packages/api/app/workflow-auth.ts`) guards the app's workflow
endpoints.

### 1.2 Two kinds of LLM prompt

dbu6 uses an LLM in two very different ways.

1. **Prompts for a coding agent** (Part A). When the app can't go further on its own (a
   statement no parser reads, a balance that doesn't add up, a possible duplicate), it shows
   a prompt and a **Copy prompt** button. The user pastes it into Claude Code or Codex,
   running in the dbu6 repository. These are open-ended, multi-step jobs: the agent reads
   and edits the repo, runs parsers and tests, calls the API, and asks the user questions
   along the way ("which account is this?", "what was the opening balance?"). They must stay
   interactive.
2. **A self-contained prompt the server sends** (Part B). Categorization sends the
   transactions no rule matched to an LLM through Nuabase and gets an account name back for
   each. It needs no tools and no conversation. Today it only runs on the Nuabase gateway,
   paid for with `NUABASE_API_KEY`.

### 1.3 What this plan builds

- **Part A:** next to **Copy prompt**, add **Open in Claude Code** / **Open in Codex**. The
  app writes the prompt to a file and opens a new terminal window running the agent
  *interactively* in the repository, with the prompt as the first message. From there the
  user carries on the conversation as if they had pasted it. Copy prompt stays.
- **Part B:** let categorization run on the coding agent installed on the user's machine,
  in Nuabase's headless mode (`claude -p` / `codex exec`), billed to the user's own
  Claude or ChatGPT plan. The Nuabase gateway stays available and remains the default.

Both parts use the same coding agents: Claude Code (`claude`) and Codex (`codex`), installed
and logged in on the machine running the dbu6 server.

### 1.4 Nuabase and its headless mode

- The Nuabase TypeScript SDK is the `nuabase` package, in the checkout
  `/Users/jasim/m/a/code/nuabase/nua-llm` (`nua-client/` is the SDK, `nua-llm-core/` the
  engine). dbu6 depends on it through a `file:` dependency
  (`packages/api/package.json`: `"nuabase": "file://Users/jasim/m/a/code/nuabase/nua-llm/nua-client"`).
- Headless mode is on that checkout's branch **`headless-mode`**, commit `4baa861` ("Run casts
  on local coding-agent CLIs (Claude Code, Codex)"). It is not merged or released: the
  published `nuabase` 2.3.4 doesn't have it.
- **API**, from the Node-only entry point `nuabase/local-agent`:
  - `localAgent({ agent: 'claude-code' | 'codex', model?, binaryPath?, timeoutMs?, concurrency?, auth?, logger? })`
    sets up one agent. It throws right away when the executable isn't on `PATH`; a missing
    login shows up as the first call's error. Defaults: `timeoutMs` 180000, `concurrency` 2,
    `auth: 'subscription'`.
  - `detectLocalAgents()` reports, for each agent in preference order (Claude Code first),
    `{ agent, installed, loggedIn, binaryPath, version }`. It runs each CLI's version and
    login-status commands, which make no model calls.
  - `Nua.direct({ localAgent })` returns a client with the same `get()` / `list()` as
    `Nua.gateway(...)`. Results are validated against the schema the same way;
    `result.source` is `'direct'` and `result.meta.engine` is `'local-agent'`.
- **How a call runs.** Each call is one CLI process in a fresh, empty temporary directory:
  - Claude Code: `claude -p --output-format json --tools "" --setting-sources ""
    --strict-mcp-config --no-session-persistence --system-prompt …`, with the schema passed
    through `--json-schema`.
  - Codex: `codex exec - --ephemeral --ignore-user-config --sandbox read-only …`, with
    `--output-schema`. Codex only accepts strict schemas; otherwise Nuabase describes the
    schema in the prompt and still validates the output.
  - No tools, no project instructions, no MCP servers.
- **Limits that matter here:**
  - **Models.** A local agent takes no provider models. A per-call `model` must be an alias
    the agent knows (`haiku`, `sonnet`, `opus` for Claude Code; none for Codex) or be left
    out, in which case the agent's `model` option or its own default applies.
  - **Batching and caching.** `list()` sends every row in **one** call. There is no row-level
    cache: that lives only in the Nuabase gateway server.
  - **Billing.** `auth: 'subscription'` removes `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and
    similar variables from the agent's environment, so the user's plan is billed.
  - **Where it runs.** It only works where the CLI is installed, which rules out the Docker
    image (`DEPLOYMENT.md`).
- **Vendor terms.** Calls count against the user's plan limits. This is meant for someone
  running dbu6 for themselves on their own subscription. Don't enable either part on an
  instance shared with other people.

### 1.5 What the CLIs support (checked 2026-09-17)

Checked against Claude Code 2.1.274 and codex-cli 0.154.0:

- `claude [options] [prompt]` "starts an interactive session by default"; the positional
  prompt is the first message.
- `codex [OPTIONS] [PROMPT]`, where the prompt is an "optional user prompt to start the
  session", runs the interactive CLI.
- Neither reads an initial prompt from a file, so Part A passes the file's contents as that
  argument (§3.2).

---

## 2. Step 0: Make Nuabase's headless mode available to dbu6

Needed by both parts: Part A uses `detectLocalAgents()`, Part B uses `localAgent()`.

dbu6's installed copy of `nuabase` is stale. Its `package.json` lists the `./local-agent`
export, but `packages/api/node_modules/nuabase/dist/esm/` has only `index.mjs`. The Nuabase
checkout's own `nua-client/dist/` does have `local-agent.mjs`. pnpm *copies* `file:`
dependencies, so dbu6 keeps the old build until it installs again.

- [x] In the Nuabase checkout, on `headless-mode`, run `pnpm build` in `nua-client/`.
- [x] In dbu6, run `pnpm install`. The version number hasn't changed, so pnpm keeps the old
      copy, and `pnpm install --force` does too ("Already up to date"). What worked: delete
      `node_modules/.pnpm/nuabase@file+..+nuabase+nua-llm+nua-client_zod@4.4.3`, move
      `node_modules/.pnpm-workspace-state-v1.json` aside, and run `pnpm install`.
- [x] Check that `packages/api/node_modules/nuabase/dist/esm/local-agent.mjs` exists and that
      `import { detectLocalAgents } from "nuabase/local-agent"` typechecks in `packages/api`.
      It typechecks, but as `any`: Nuabase's `.d.mts` files import `'./nua-llm-core/local-agent'`
      without an extension, which NodeNext can't resolve, and `skipLibCheck` hides it. The same
      holds for `import { Nua } from "nuabase"`, before this plan too. dbu6 declares structural
      types for what it uses (§6).
- [ ] Once Nuabase releases a version with `nuabase/local-agent`, dbu6 can move to it. That is
      a follow-up, not part of this plan.

---

## 3. Part A: Run agent prompts interactively in a terminal

### 3.1 The prompts

Every prompt the app offers to copy, and all of them get this treatment. None is changed by
this plan: both **Copy prompt** and the new buttons use the same string.

**Import statements screen** (`/import`). Builders are in
`packages/frontend/src/views/import-statements/agentPrompts.ts`. `describeProblems.ts`
attaches a prompt to a problem card as `agent: AgentHandoff` (`{ prompt, afterwards }`), and
`cards.tsx` shows it in the card's coding-agent disclosure with `CopyPromptButton`.

| # | Builder | Shown when | What the agent is asked to do |
|---|---|---|---|
| 1 | `unrecognizedPrompt` | A file no saved parser recognises (plan file status `unrecognized`) | Build a deterministic parser under `custom-built-parsers/` following its README and `import-statement-parser-guide.md`, with a sanitized fixture and tests; add or update the preset; run it on the real file and report balances, date range and row count |
| 2 | `ambiguousPrompt` | More than one parser recognises the file (`ambiguous`) | Tighten the fingerprints so each parser rejects the other's layout, with tests |
| 3 | `noPresetPrompt` | Unresolved, `no_preset_for_parser` | Add a preset to `data/user-config/import-presets.json`, asking the user for the account's name, ledger account and whether it's a card |
| 4 | `identifierRequiredPrompt` | Unresolved, `statement_account_identifier_required` | Make the parser emit the account identifier, or discuss dropping it from the preset |
| 5 | `identifierMismatchPrompt` | Unresolved, `statement_account_identifier_mismatch` | Add a preset for the new account that shares the parser |
| 6 | `balanceMismatchPrompt` | Refusal `balance_mismatch` or `segment_balance_mismatch` | Find why the balances don't add up; fix the parser, or name the missing dates |
| 7 | `boundaryGapPrompt` | Refusal `statement_boundary_mismatch` | Check the edges of two statements; name a missing period or fix the parser |
| 8 | `disagreementPrompt` | Refusal `statement_disagreement` | Work out which file is right on the day they differ |
| 9 | `partInvalidPrompt` | Refusal `statement_part_invalid` | Decide whether the bank's export or the parser is wrong; fix the parser if it is |
| 10 | `reconciliationPrompt` | Refusal `reconciliation_match_failed` | Compare the ledger and the statement around the last reconciled balance, and propose the fix before changing anything |
| 11 | `openingBalancePrompt` | Refusal `opening_balance_unavailable` | Ask the user for the opening balance and add a balance assertion, or make the parser emit it |
| 12 | `closingBalancePrompt` | Refusal `closing_balance_unavailable` | Make the parser emit the card's closing balance |
| 13 | `genericFailurePrompt` | Refusals `assertion_conflict`, `ambiguous_duplicate`, `abacus_json_parse_failed`, `categorization_config_error` | Investigate from the error payload and propose the fix before changing the ledger |

Prompts 3 and 6–13 end with `RERUN_BLOCK`, which tells the agent how to re-run the import
through the API with `SAPPORTA_API_TOKEN`. Two problems have no prompt:
`statement_part_unjoinable`, and the forbidden / network / unexpected-reply cards.

**Review screen, Duplicates and Balance checks tabs.** Builders are in
`packages/frontend/src/review/agentPrompts.ts`. `AskYourAgent` in
`packages/frontend/src/review/report-tab.tsx` shows them with `CopyPromptButton`.

| # | Builder | Shown on | What the agent is asked to do |
|---|---|---|---|
| 14 | `duplicatesPrompt` | Duplicates tab (`review/DuplicatesTab.tsx`) | For each possible duplicate, decide whether it is one real transaction or two and propose the change; don't change data without asking |
| 15 | `balanceChecksPrompt` | Balance checks tab (`review/BalanceChecksTab.tsx`) | Find the first failing day, explain the difference, and propose the exact fix by id; don't change data without asking |

**Import freeform transactions screen**
(`packages/frontend/src/views/ImportFreeformTransactions.tsx`). The builder is in
`views/freeform-transactions/freeformTransactionsPrompt.ts`.

| # | Builder | Shown when | What the agent is asked to do |
|---|---|---|---|
| 16 | `freeformTransactionsPrompt` | The user has chosen the kind (bank or card) and the ledger account | Following `custom-built-parsers/freeform-transactions-guide.md`, turn the transactions the user pastes into Abacus JSON, ask for the opening and closing balances, post to `/api/import-draft/abacus`, and report the result |

For prompt 16 the transactions follow the prompt. In a terminal session the user pastes them
as their first reply; the prompt already says "If nothing follows, ask me for them."

### 3.2 Decisions and their reasons

1. **Interactive, not headless.** These prompts ask the user questions and change the repo.
   The user needs to watch, answer, and approve edits and commands with the agent's normal
   permission prompts. The goal is only to save the copy-paste, not to automate the work.
2. **Write the prompt to a file, and start the agent from a small launcher script.** Neither
   CLI reads an initial prompt from a file, and the prompts can't safely go on a command
   line: they are multi-line and contain quotes, backticks, backslashes and literal
   `$SAPPORTA_API_URL` / `$SAPPORTA_API_TOKEN` (in `RERUN_BLOCK`), which the agent must see
   as written. In `"$(cat file)"` the shell passes the file's contents through as one
   argument and doesn't expand anything inside them. Prompts are a few tens of KB at most,
   well under macOS's 1 MiB argument limit.
3. **The launcher only contains paths the server generated.** Prompt text goes into the
   `.md` file and never into the script, so it can't inject shell commands.
4. **Run from the project root**, so the agent loads `AGENTS.md` / `CLAUDE.md` just as it does
   when the user pastes the prompt in a session they started in the repository.
5. **Use the agent's absolute path from `detectLocalAgents()`**, so the launcher runs the
   binary the server detected even if the terminal's `PATH` differs.
6. **Open the terminal with `open <launcher>.command` on macOS.** macOS runs `.command` files
   in the user's default app for them (Terminal unless they've changed it). This needs no
   Automation permission, unlike AppleScript, and no code for particular terminal apps.
7. **Other POSIX systems get the command, not a window.** On Linux the button writes the same
   files and shows `sh '<launcher path>'` to copy into any terminal. The same command is
   offered on macOS as a fallback, for when the window doesn't open or the user works in an
   IDE terminal.
8. **Windows: Copy prompt only.** The launcher is a POSIX shell script.
9. **Show buttons only for agents that are installed on the server's machine.** No extra
   setting is needed: the Docker image has no agent, so a deployed instance shows Copy
   prompt only. Being logged in isn't required, because an interactive CLI asks the user to
   log in.
10. **Files go under `tmp/agent-prompts/`.** `tmp/` is gitignored (`.gitignore`), and prompts
    carry file names, balances and narrations. The prompt file is written with mode 0600 and
    the launcher with 0700.
11. **Taking prompt text from the browser is acceptable here.** The endpoint requires
    `requireWorkflowAuth`, accepts only the two agent names, and starts an *interactive*
    session in which every edit and command still needs the user's approval.

### 3.3 Design

**Contract**: `packages/shared/src/contracts/agent-handoff.ts`, exported from
`contracts/index.ts`. The agent names and their labels (`codingAgentSchema`,
`CODING_AGENT_LABEL`) are in `contracts/coding-agent.ts`, which Part B's report also uses.

- `GET /agent-handoff` → 200
  `{ agents: ('claude-code' | 'codex')[], open_terminal: boolean, shell_command: boolean }`
  - `agents`: the installed ones, Claude Code first.
  - `shell_command`: `agents.length > 0` and the platform isn't `win32`.
  - `open_terminal`: `shell_command` and the platform is `darwin`.
- `POST /agent-handoff`, body `{ agent: 'claude-code' | 'codex', prompt: string (1 to 256000 characters), open: boolean }`:
  - 200 `{ prompt_path, launcher_path, command }`, with absolute paths; `command` is
    `sh '<launcher_path>'`.
  - 400 `{ error, message }` when the agent isn't installed (`agent_not_installed`),
    `shell_command` is false, i.e. on Windows (`agent_handoff_unsupported`), the prompt is
    131072 bytes or more on Linux, where one argument can't be that long (`prompt_too_long`),
    or `open` is true and `open_terminal` is false (`terminal_unavailable`).
  - 403 through `requireWorkflowAuth`.
  - 500 `{ error: "terminal_open_failed", message }` when `open` exits non-zero. The files
    are still written, so the message includes `command`.

**Launcher**: `packages/api/agent-handoff/launcher.ts`, pure, with no I/O.

```ts
launcherScript({ projectRoot, binaryPath, promptPath }): string
```

produces

```sh
#!/bin/sh
cd '/abs/project/root' || exit 1
exec '/abs/path/to/claude' -- "$(cat '/abs/project/root/tmp/agent-prompts/<name>.md')"
```

Every path is single-quoted, with each `'` written as `'\''`. `--` ends the CLI's options, so
a prompt that starts with `-` can't set flags (both CLIs honour it). The same script works for
Codex, with Codex's binary path.

**Handler**: `packages/api/app/agent-handoff.ts`, mounted in `loadApp` in
`packages/api/app.ts`.

- **Project root:** `projectRoot()` from `@sapporta/server` (the directory with
  `sapporta.json`).
- **Detection:** `detectLocalAgents()` from `nuabase/local-agent`, kept in memory for 60
  seconds, so installing an agent shows up without restarting and a click doesn't wait on
  the CLIs.
- **POST:**
  1. Create `tmp/agent-prompts/`.
  2. Write `<YYYY-MM-DDTHH-MM-SS>-<agent>-<4 hex>.md` (the prompt) and `.command` (the
     launcher) with the modes in §3.2.
  3. If `open`, run `execFile('open', [launcherPath])` and wait for it to exit.
- **Old files:** none are deleted.

**Frontend**: `packages/frontend/src/components/agent-prompt-actions.tsx` replaces
`components/copy-prompt-button.tsx` (delete the old file once nothing imports it).

- **Props:** `{ prompt: string }`.
- **Data:** fetches `GET /agent-handoff` with react-query under one key and a long
  `staleTime`, through a client added to `packages/frontend/src/api.ts`. The query is
  `agentHandoffCapabilitiesQuery` in `queries.ts` (10 minutes). If it fails, only Copy prompt
  shows.
- **Buttons:**
  - **Copy prompt**, always.
  - One button per installed agent: **Open in Claude Code** / **Open in Codex** when
    `open_terminal`, or **Command for Claude Code** / **Command for Codex** when only
    `shell_command`.
- **After a click:**
  - An Open button shows a line saying the agent opened in a new terminal window and to
    answer it there, plus "Didn't open?" with the command and a Copy button.
  - A Command button shows the command and a Copy button. The command is shown before it's
    copied because the clipboard write would follow a network round trip, and Safari
    only allows clipboard writes straight from a click.
  - Errors show the server's message.
- **Call sites** (update their explanatory text to cover both routes; keep the prompt
  preview `<pre>`):
  - `views/import-statements/cards.tsx`: the coding-agent disclosure. Keep
    `problem.agent.afterwards`.
  - `review/report-tab.tsx`: `AskYourAgent`.
  - `views/ImportFreeformTransactions.tsx`: step 2. Tell the user to paste the transactions
    as their first reply in the terminal, or right after the prompt if they copy it.

### 3.4 Steps

**Step A1: API.** Prerequisite: Step 0.
- [x] Contract `agent-handoff.ts` in `packages/shared`, exported from the index.
- [x] `packages/api/agent-handoff/launcher.ts` and its test:
  - paths with spaces and single quotes;
  - the script never contains the prompt text;
  - it runs the given binary path;
  - the whole script matches an expected string.
- [x] `packages/api/app/agent-handoff.ts`, mounted in `app.ts`, with a test in the style of
  `app/import-draft-abacus.test.ts`:
  - `GET` capabilities for darwin, linux and win32, with detection mocked;
  - `POST` writes both files with the right modes under a temporary project root;
  - 400 for an agent that isn't installed and for `open` on linux;
  - `open` is called with the launcher path (mock `execFile`).
- [x] `pnpm typecheck` and `pnpm test` pass.

**Step A2: Frontend.** Prerequisite: A1.
- [x] `agent-prompt-actions.tsx` and a component test: which buttons show for each
  capabilities response; POST body; the command shown after a click; the error message.
- [x] Replace `CopyPromptButton` at the three call sites and update their text; delete
  `copy-prompt-button.tsx`.
- [x] `pnpm typecheck`, `pnpm test`, `pnpm format:check` pass. (Except for
  `describeProblems.test.ts`'s unrecognised-file test, which already failed on `main`; see
  commit 25621c8 and §6.)

**Step A3: Docs and a manual check.** Prerequisite: A2.
- [x] Mention the Open buttons in `README.md` (statement parsers and freeform import) and
  `custom-built-parsers/freeform-transactions-guide.md` (where the prompt comes from).
- [ ] On macOS with both CLIs installed, against scratch data (§0, rule 5), with
  `pnpm dev` running:
  - [ ] **Import card:** drop a file no parser reads and click **Open in Claude Code**. A
    terminal opens in the repository, and the session starts with the full prompt. Check
    that `$SAPPORTA_API_URL`, the backslashes and the backticks arrived unchanged, and that
    you can answer the agent's first question.
  - [ ] **Codex:** repeat with **Open in Codex**.
  - [ ] **Freeform import:** **Open in Claude Code**, then paste sample transactions as the
    first reply.
  - [ ] **Review:** one Duplicates or Balance checks prompt.
  - [ ] **Fallback:** the command runs from a terminal that is already open.
- [ ] Record results and any CLI quirks (for example the folder-trust question on first run)
  in the progress log.

---

## 4. Part B: Run categorization on the local coding agent

### 4.1 The prompts

A search of `packages/` and `scripts/` for `nuabase`, `openrouter`, `anthropic` and `openai`
finds **one** LLM call: categorization, in
`packages/api/bank-importer/categorization/llm-categorization.ts`. Nothing else sends a
prompt to Nuabase or any other LLM API. The only other hit is sample narration text in
`scripts/seed-sample-data.mjs`.

**The categorization prompt**
- **Prompt:** `PROMPT_TEMPLATE` (`categorization/prompt-template.ts`), with
  `{hledger_accounts}` filled from `hledger_accounts.prompt` and `{custom_mapping}` from the
  preset's `custom_mappings_filenames`. Both live in the user-config directory
  (`userConfigDir()`, under `SAPPORTA_DATA_DIR`).
- **Which transactions:** only those the rules in `transaction_mappings.mjs` didn't map
  (`categorization/resolve.ts`).
- **Input rows:** `{ id: 'txn-N', text: 'Expense: <narration>' | 'Deposit: <narration>' }`,
  with identical texts sent once.
- **Call:**
  `nua.list(prompt, { input: rows, primaryKey: 'id', output: { name: 'account', schema: z.string() }, model: { provider: 'openrouter', model: 'z-ai/glm-5.2' } })`
  on `Nua.gateway({ apiKey })`, created on every call.
- **Result:** an empty string leaves the transaction uncategorized. On failure the error is
  logged and swallowed, and every one of those transactions stays uncategorized.

**Two ways in**
1. **Statement imports.** `POST /api/import-draft/statements/auto`
   (`app/import-draft-statements-auto.ts`) and the freeform
   `POST /api/import-draft/abacus` (`app/import-draft-abacus.ts`) call `runStatementImport`
   (`bank-importer/statement-import.ts`, which reads `NUABASE_API_KEY`). That calls
   `runDraftImport` (`draft-import.ts`), then `processStatement` (`pipeline.ts`), then
   `resolveCategories`, then `categorizeViaLLM`.
2. **Reclassify drafts** (`packages/frontend/src/views/ReclassifyDrafts.tsx`).
   `POST /api/draft-transactions/classify` and `/classify-with-gpay`
   (`app/classify-draft-transactions.ts`, which reads `NUABASE_API_KEY` in both handlers)
   call `classifyDraftTransactions` (`modules/draft-transactions/classification.ts`), then
   `resolveCategories`, then `categorizeViaLLM`.

`NUABASE_API_KEY` is read in three places and passed down as
`CategorizationConfig.nuabaseApiKey` / `LLMCategorizationConfig.nuabaseApiKey`.

### 4.2 Decisions and their reasons

1. **One explicit setting, defaulting to Nuabase.** `LLM_ENGINE` is `nuabase` (the default
   when unset), `claude-code` or `codex`. Detection doesn't choose it: switching between the
   Nuabase account and the user's own plan must never happen silently, and existing setups
   and the Docker image keep working unchanged.
2. **The model belongs to the engine.**
   - `nuabase` keeps `{ provider: 'openrouter', model: 'z-ai/glm-5.2' }`.
   - Local agents get `LOCAL_AGENT_MODEL`, the CLI's own model name (e.g. `haiku` or
     `sonnet` for Claude Code), passed to `localAgent({ model })`. Unset means the CLI's
     default.
   - No per-call model is sent to a local agent: it rejects provider models.
3. **Build the engine once.** A getter creates it on first use and keeps it for the process,
   in the style of `userConfigDir()`. `boot.ts` calls it at startup, so these stop the server
   with a clear message:
   - an unknown `LLM_ENGINE`;
   - `LLM_ENGINE=claude-code` (or `codex`) without the executable on `PATH`
     (`localAgent()` throws);
   - a `LOCAL_AGENT_BINARY` that isn't an absolute path to an executable file. dbu6 checks
     this itself, because `localAgent()` only looks up `PATH`. It must be absolute because the
     agent runs in a temporary directory.

   A missing `NUABASE_API_KEY` doesn't stop the server: imports still work, uncategorized,
   as today, and decision 5 says why.
4. **Local agents get at most 50 distinct texts per call.** Each call is one CLI process
   with a 180 s timeout, and Nuabase runs two at once. The gateway is unchanged: one call.
   Record the chosen size, and the timings seen in Step B4, in the progress log.
5. **Report failures instead of swallowing them.** With a local agent, being logged out,
   hitting plan limits and timeouts are all likely, and today each would silently leave
   drafts uncategorized. Import results and classify responses carry a `categorization`
   report (§4.3), and the screens show it.
6. **No cache with a local agent, for now.** Reclassify sends every unmapped text again. A
   row cache for direct mode belongs in Nuabase (follow-up, §5).
7. **Keep `auth: 'subscription'`** so the user's plan is billed, not an API key that happens to
   be set.
8. **Same prompt, rows and parsing for every engine.** Only where the call runs changes.
9. **Imports stay synchronous requests.** A large import on a local agent takes longer.
   Step B4 measures it; a background job is a follow-up only if the timings call for one.

### 4.3 Design

**Settings.** Add to `mise.toml.example` (`[env]`, next to `NUABASE_API_KEY`) and document
in `DEVELOPMENT.md`:

```toml
# Where categorization runs: nuabase (default, needs NUABASE_API_KEY), claude-code, or codex.
# claude-code and codex use the agent installed and logged in on this machine, billed to your plan.
LLM_ENGINE =
# Optional. The agent's own model name, e.g. "haiku" or "sonnet" for Claude Code.
LOCAL_AGENT_MODEL =
# Optional. The agent's executable, when it isn't on the server's PATH.
LOCAL_AGENT_BINARY =
```

**Engine module**: `packages/api/llm-engine.ts`, next to `user-data.ts` and `mailer.ts`.

- `parseLlmEngineSettings(env)` is pure and returns the settings or a message saying what's
  wrong:
  - `{ engine: 'nuabase', apiKey: string | null }`
  - `{ engine: 'claude-code' | 'codex', model: string | undefined, binaryPath: string | undefined }`
- `categorizationLlm()` is the memoized getter (§4.2, decision 3). Its result, a
  `CategorizationLlm`, holds:
  - `engine`: its name, for logs and the report;
  - `caller`, how to call `list()`: `{ ready: true, nua, model }` with a `Nua` client and the
    model to pass, or `{ ready: false, reason }` (`NUABASE_API_KEY is not set`);
  - `maxRowsPerCall`: `null` for the gateway, `50` for local agents.

  `buildCategorizationLlm(settings)` builds one from parsed settings; the getter reads
  `process.env`. `nuabase`'s declarations resolve to `any` under NodeNext (§2), so the module
  declares the part of the client it calls (`NuaListClient`).

  How it's built:
  - Gateway: `Nua.gateway({ apiKey })`.
  - Local agents:
    `Nua.direct({ localAgent: localAgent({ agent, model, binaryPath: env.LOCAL_AGENT_BINARY }) })`
    with Nuabase's defaults otherwise.

**Categorization.**
- **Settings and entry points:**
  - `LLMCategorizationConfig.nuabaseApiKey` becomes `llm: CategorizationLlm`, and so does
    `CategorizationConfig.nuabaseApiKey`.
  - The three call sites that read `process.env.NUABASE_API_KEY` pass
    `categorizationLlm()` instead.
- **`categorizeViaLLM`:**
  - It stops creating a client and uses `config.llm`.
  - It splits the rows by `maxRowsPerCall`, runs the calls together, and keeps the answers
    of the calls that succeeded.
  - It returns `{ mappings, report }`.
- **Report**, a shared schema in `packages/shared/src/contracts/import-drafts.ts`:

  ```ts
  categorization: {
    engine: 'nuabase' | 'claude-code' | 'codex',
    sent_count: number,    // distinct texts that needed the LLM
    failed_count: number,  // of those, how many got no answer because a call failed or couldn't run
    error: string | null,  // the first failure's message
  }
  ```

  When rules map everything, or an import has no new rows, `sent_count` is 0. The same file
  exports `categorizationEngineSchema` and `CATEGORIZATION_ENGINE_LABEL`. `error` is shortened
  for screens by `reportedError` in `llm-categorization.ts`: an HTML error page becomes its
  `<title>`, whitespace is collapsed, and it is cut at 300 characters. The log keeps the full
  message.
- **Passing the report up:**
  - `resolveCategories` returns the categorized transactions and the report.
  - `processStatement` and `runDraftImport` pass it up into the import summary. Add
    `categorization` to both copies of `importSummarySchema`:
    `packages/api/bank-importer/draft-import.ts` and
    `packages/shared/src/contracts/import-drafts.ts`.
  - `classifyDraftTransactions` returns it too.
- **Classify responses:**
  - `/draft-transactions/classify` changes from an array to `{ transactions, categorization }`.
  - `/classify-with-gpay` adds `categorization` next to `gpay_enriched_count`.
- **Screens:** both use `describeCategorizationProblem` in
  `views/categorization/describeCategorization.ts` for the wording.
  - Import statements (`views/import-statements/describeGroup.ts`): when `failed_count > 0`,
    the account's result says how many descriptions weren't categorized and why.
  - `ReclassifyDrafts.tsx` shows the same.
  - Freeform guide §5: mention the field so the agent reports it.
- **Logs:** the existing console logs of prompt, rows and response stay, prefixed with the
  engine name.

### 4.4 Steps

**Step B1: One engine setting, Nuabase only, same behaviour.** No prerequisite.
- [x] `packages/api/llm-engine.ts` with `parseLlmEngineSettings` (tested: unset, each engine,
  an unknown value, blank model) and `categorizationLlm()` for `nuabase` only.
- [x] Replace `nuabaseApiKey` with `llm` through `CategorizationConfig` and
  `LLMCategorizationConfig`; remove the three `process.env.NUABASE_API_KEY` reads.
- [x] Tests pass a fake `CategorizationLlm` whose `list` is a mock:
  - `llm-categorization.test.ts` drops its `vi.mock('nuabase')`;
  - `resolve.test.ts` and `classification.test.ts` pass it where they now pass
    `nuabaseApiKey`.
- [x] `boot.ts` calls `categorizationLlm()` at startup.
- [x] `pnpm typecheck`, `pnpm test` pass; an import on the gateway behaves as before.

**Step B2: The report.** Prerequisite: B1.
- [x] `categorizeViaLLM` returns `{ mappings, report }`; a missing API key and a failed call
  are reported rather than swallowed.
- [x] Carry the report through `resolveCategories`, the import summary (both schemas) and the
  classify responses (§4.3). Update `ReclassifyDrafts.tsx` for the new classify response.
- [x] Show it on the Import statements result and on Reclassify drafts.
- [x] Tests: report counts for all mapped, all sent, one failed call among several, and a
  missing key; the contract changes in the existing endpoint tests.

**Step B3: Local agents.** Prerequisites: Step 0, B2.
- [x] `claude-code` and `codex` in `categorizationLlm()`, with `LOCAL_AGENT_MODEL` and
  `LOCAL_AGENT_BINARY`; startup fails clearly when the executable isn't found (§4.2,
  decision 3).
- [x] Splitting by `maxRowsPerCall`; tests with a fake client: 120 texts become 50/50/20,
  answers from all calls are merged, and one failed call counts only its own rows.
- [x] `mise.toml.example` and `DEVELOPMENT.md` (replace "All LLM calls go through Nuabase"
  with the three engines and how to choose). `DEPLOYMENT.md`: the container must use
  `nuabase`. `README.md`, "Automatic categorization": the LLM can be Nuabase or the user's
  coding agent.

**Step B4: Try it.** Prerequisite: B3.

Against scratch data (§0, rule 5), with `pnpm seed`:
- [x] Reclassify the seeded drafts with `LLM_ENGINE=claude-code` using `haiku` and then
  `sonnet`, and with `codex`. Compare the accounts with the gateway's, and note which
  `LOCAL_AGENT_MODEL` to recommend in the docs.
- [x] Time an import of about 200 distinct narrations on each engine. If a local agent is too
  slow for a synchronous request, record the numbers and propose a follow-up; don't build
  one here.
- [x] Log out of the agent, or point `LOCAL_AGENT_BINARY` at a non-agent, and check the screen
  explains why nothing was categorized.
- [x] Record the results in the progress log.

---

## 5. Out of scope, and follow-ups

- **Tools or MCP in headless runs.** Part B stays tool-free. Categorization reads untrusted
  narrations and gains nothing from tools.
- **Running Part A's prompts headless.** They stay interactive (§3.2, decision 1).
- **A row-level cache for Nuabase direct mode**, so reclassifying on a local agent doesn't
  resend known texts. This is Nuabase work.
- **A Nuabase release with `nuabase/local-agent`**, and moving dbu6 off the `file:`
  dependency.
- **A Windows launcher** for Part A.
- **Background jobs for imports**, only if Step B4's timings call for them.

---

## 6. Progress log

- **2026-09-17:** Plan written. Found that dbu6's installed `nuabase` predates the
  headless-mode build (Step 0).
- **2026-09-17, Step 0:** Built `nua-client` on `headless-mode` (the checkout was one commit
  ahead of `4baa861`: `1b8c4b9`, "Drop $schema from nested schemas in the cast envelope").
  `pnpm install` and `pnpm install --force` both kept the stale copy; deleting pnpm's virtual
  store entry for `nuabase` and moving `node_modules/.pnpm-workspace-state-v1.json` aside made
  `pnpm install` copy the new build. `pnpm-lock.yaml` didn't change. **Finding:** under
  NodeNext, both `nuabase` and `nuabase/local-agent` import as `any` (extensionless relative
  imports in Nuabase's `.d.mts`). Follow-up for Nuabase: emit resolvable declarations; then
  drop dbu6's structural `NuaListClient` / `DetectedAgent` types.
- **2026-09-17, Steps A1–A2 and A3's docs:** Built as §3.3. Deviations: the agent enum and
  labels live in `contracts/coding-agent.ts`; POST also returns 400
  `agent_handoff_unsupported` on Windows, where an agent may be installed but there is no
  launcher; files are written with `flag: "wx"` in a `tmp/agent-prompts/` created with mode
  0700; detection is cached as a promise and forgotten if it rejects. The launcher test also
  runs a real launcher against a stand-in agent, in a path with a space and a `'`, and checks
  that the prompt arrives as one unchanged argument (`$SAPPORTA_API_TOKEN`, backticks,
  backslashes, `$(…)`). `pnpm test`: all pass except `describeProblems.test.ts`'s
  unrecognised-file test, which already failed on `main` (commit 25621c8 says the test was
  left behind on purpose). The Sapporta skill wasn't installed; installed it globally as
  `AGENTS.md` says.
- **2026-09-17, A3 checks, partial:** Against a scratch API and Vite (ports 2396/2395, data
  in `/tmp`), signed in as the seeded demo user: `GET /api/agent-handoff` detected both agents
  (`open_terminal: true`); `POST` with `open: false` wrote the `.md` (0600) and `.command`
  (0700) with the detected `/opt/homebrew/bin/codex`; an empty prompt got 400 and no session
  got 401. The freeform import screen shows Copy prompt, Open in Claude Code and Open in Codex.
  **Not done:** clicking Open. It opens real terminal windows on the owner's desktop and starts
  an agent working in the repository, and needs someone to answer it. Those checkboxes remain
  for the owner.
- **2026-09-17, Steps B1–B3:** Built as §4.3. Deviations: `CategorizationLlm.caller` is a
  `ready` union; `categorizeViaLLM` also catches a thrown `list()` and reports it; the report's
  `error` goes through `reportedError` (added after B4, below); the screens' wording is
  `describeCategorizationProblem`; `/api/agent-handoff` is asserted in `app.test.ts`. Chunk
  size for local agents: 50.
- **2026-09-17, Step B4** (scratch data, `pnpm seed`; `hledger_accounts.prompt` replaced with
  the seeded ledger's 73 leaf accounts so answers could match):
  - **Reclassify the 25 seeded HDFC drafts (23 distinct descriptions):** gateway 51 s,
    Claude Code `haiku` 63 s, `sonnet` 17 s, Codex (default model) 16 s, all in one call.
    Gateway, `sonnet` and Codex chose identical accounts; each agreed with the seeded
    accounts on 22 of 25 (they also categorized two drafts the seed left blank). `haiku`
    agreed on 21 and left the car-loan EMI and both card payments blank. Recommended in
    `DEVELOPMENT.md`: `sonnet` for Claude Code.
  - **Freeform import of 200 distinct descriptions** (`POST /api/import-draft/abacus`,
    sbi-savings, drafts deleted between runs): Codex 43 s (147 of 200 categorized), `sonnet`
    54 s (155; the four 50-row calls took 18–29 s each), `haiku` 148 s (147). All local runs
    reported no failures. **The Nuabase gateway failed both times**, after about 60 s, with an
    HTML "something went wrong (500)" page. Before this plan that was swallowed silently; now
    the import succeeded, uncategorized, with `failed_count: 200`. That HTML page was the
    report's `error`, so `reportedError` now reduces it to its title.
  - **Speed:** up to about a minute on a local agent at `sonnet` or Codex, 2.5 minutes at
    `haiku`, still inside one synchronous request. No background job is proposed on these
    numbers. Larger imports scale with calls ÷ 2 × about 25 s.
  - **Failure on screen:** with `LOCAL_AGENT_BINARY=/usr/bin/false`, Classify drafts on 200
    rows returned in 3 s and showed "Couldn't categorize any of the 200 descriptions with
    Claude Code … LLM call failed after 3 attempts. Last error: claude: exited with code 1
    without a JSON result". The Import statements card uses the same wording (unit-tested,
    not checked in a browser).
  - **Startup:** `LLM_ENGINE=openai`, `LLM_ENGINE=codex` without `codex` on `PATH`, and a
    missing `LOCAL_AGENT_BINARY` each stop the server with a message naming the fix.
  - **Follow-ups:** (1) the gateway's single call fails on about 200 rows; consider
    `maxRowsPerCall` for the gateway too, or fix the gateway's timeout (Nuabase). (2) A
    `/usr/bin/false` binary passes the startup check (it is an executable file) and only fails
    per call; a version check at startup would catch it, at the cost of running the CLI.
- **2026-09-17, review fixes:** A review of the diff found, and these were fixed:
  - **Flag injection.** The launcher passed the prompt without `--`, so a prompt starting with
    `-` was read as the agent's options. Anyone holding a workflow token (such as an agent
    given `SAPPORTA_API_TOKEN`) could have opened a session with flags of their choosing. The
    launcher now emits `--`, and the real-launcher test uses a prompt starting with `--`.
    Checked: `claude -- --version` doesn't print the version, and `codex -- "--…"` is taken as
    a prompt where `codex "--…"` is refused.
  - **Linux argument limit.** POST returns 400 `prompt_too_long` at 131072 bytes or more on
    Linux.
  - **Relative `LOCAL_AGENT_BINARY`.** It passed the startup check, then failed every call from
    the agent's temporary directory; it is now refused at startup.
  - **Error objects.** A non-string `error` from `list()` would have thrown from `reportedError`;
    it is now `String()`-ed.
  - **Re-imports.** The result card no longer reports a categorization failure when nothing
    new came in: rows are categorized before `persistDrafts` drops those already in Review.
  - **One empty report.** `nothingSentReport(engine)` replaces four copies of the empty report,
    and `processStatement` now requires its categorization config (its only caller always
    passed one).
  - **New tests:** routes return 403 without workflow access, before detection; a result is
    dropped when the prompt changes; the vacuous "script never contains the prompt" test was
    removed (the handler test compares the whole launcher file).

  Not changed: `handoffErrorMessage` (prefers `message`) sits beside `apiErrorMessage` (reads
  `error`); merging them would change other screens' errors. `ReclassifyDrafts.tsx` still
  hand-types the GPay response, as before. Rows a successful call leaves out aren't counted in
  `failed_count`, as §4.3 defines it.
- **2026-09-17, one coding agent for everything, chosen in Settings.** At the owner's request,
  AI now defaults to the local coding agent, and the Nuabase gateway is deprecated.
  - **Which agent:** `packages/api/coding-agent.ts` detects Claude Code and Codex (detection
    moved there from `app/agent-handoff.ts`, same one-minute cache) and uses the one saved in
    `data/user-config/settings.json`, or the first installed until one is chosen. A chosen
    agent that is later uninstalled falls back to the other.
  - **Settings screen** (`/settings`, in the sidebar under the everyday items and on All
    tools): a Claude Code / Codex picker, uninstalled ones disabled, and one line: connected
    and what it does, not signed in with the command to sign in, or no agent found and what
    won't work. `GET`/`PUT /api/coding-agent` detect afresh each time.
  - **Categorization:** `categorizationLlm()` is async and runs on the current agent; with
    none, the report's `engine` is null and its error says no coding agent was found.
    `LLM_ENGINE` only accepts `nuabase` (deprecated override; any other value stops the
    server). `LOCAL_AGENT_MODEL` and `LOCAL_AGENT_BINARY` are gone: the binary comes from
    detection, and Claude Code runs on `sonnet` (Step B4's recommendation), Codex on its default.
  - **Agent prompts:** `GET /api/agent-handoff` returns the one `agent` (or null), `POST` no
    longer takes one, and the screens show a single Open (or Command) button for it.
- **2026-09-17, models checked at startup, prompts in auto mode.** At the owner's request.
  - **Models:** `packages/api/coding-agent-models.ts` lists each agent's models, most capable
    first: Claude Code `opus`, `sonnet`; Codex `gpt-5.6-sol`, `gpt-5.6-terra`. The last is a
    floor (Sonnet-class): Luna and Haiku are never used. Each model is asked for a one-word
    reply through Nuabase (`nua.get`, 60 s timeout) at startup for every signed-in agent, when
    Settings shows an unchecked agent, when a prompt or categorization finds that no model
    answered last time, and on **Check models again** (`POST /api/coding-agent/model-check`).
    Prompts open on the most capable model that answered; categorization runs on the least
    capable. `GET /api/coding-agent` gives each agent's `models` (`not_checked`, `checking`,
    `ready` with `session`, `categorization` and `unavailable`, or `no_model`); Settings
    polls every 2 s while the active agent's check runs. With no model answering, handoff
    refuses with `no_agent_model` and categorization reports why.
  - **Auto mode:** the launcher starts `claude --model <m> --permission-mode auto` or
    `codex --model <m> --approve-for-me` (auto review in the workspace-write sandbox). This
    supersedes §3.2 decision 1 (the agent's reviewer, not the user, approves edits) and the
    reason in decision 11: taking prompt text from the browser stays acceptable because only a
    workflow user can post one and the session runs in a terminal in front of the user.
    Headless categorization is unchanged: Claude Code has no tools and Codex runs `exec` in a
    read-only sandbox, so there is nothing to approve.
  - **Found:** checked against Claude Code 2.1.274 and codex-cli 0.154.0 on the owner's
    logins, `opus`, `sonnet` and `gpt-5.6-terra` answer in 3 to 6 s. `gpt-5.6-sol` is refused
    ("not supported when using Codex with a ChatGPT account", since 2026-08-09, and absent
    from `codex debug models`), so Codex falls back to Terra for both.
  - **Checked** with the real CLIs against a scratch data directory: startup logged both
    agents' models; the Settings route went from `checking` to `ready` with Sol's reason; the
    launchers named `opus` and `gpt-5.6-terra` with the auto-mode flags; categorization ran on
    `claude-sonnet-5` and `gpt-5.6-terra` and chose the expected accounts. The Settings screen
    itself wasn't seen in a browser (it needs a sign-in).
  - **Follow-ups:** a model that answered at startup but fails later (a usage limit, say) is
    not dropped until **Check models again** or a restart. Nuabase retries Claude Code's
    unknown-model error three times, so checking a model that doesn't exist takes about 10 s.
