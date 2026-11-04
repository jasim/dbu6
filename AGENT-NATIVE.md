# AGENT-NATIVE.md

This file explains the goals of dbu6, its current progress, and the internals that determine how to evaluate a change. Read this file before you design, audit, or review any workflow, screen, agent prompt, playbook, or guide. The run guide (`docs/run-guide.md`) and the playbooks (`docs/playbooks/`) explain how the agent does the work, whereas this file explains why we shape the work this way and how to evaluate a screen or a button.

## Sync

This file describes the repository through commit `ce1629c4f3584b0c333f7fb65b19c05bfdaebc10` (`2026-11-03 List an account's running balance as its checks add it up`).

To update this file, run `git log <marker>..HEAD`, update the sections affected by those commits, and move the marker. If a commit does not change a workflow, prompt, playbook, or screen, you do not need to update this file.

## The idea

dbu6 is a shim that connects coding agents to a local SQLite ledger. The user's coding agent (such as Claude Code, Codex, or Pi) writes parsers for their bank statements, builds the chart of accounts, categorizes transactions using plain-English rules, and balances the double-entry books.

Before we added the automated run workflow, the user had to trigger each step manually. They had to open the app and click a button for each task, such as "Classify these" and then "Figure out why these balances mismatch." Although the AI helped with each step, the user still had to move the workflow from one step to the next. That manual handoff is a leftover from software built before AI, because an agent that can write a parser can also determine which step comes next.

Because the agent runs the workflow, the user only needs to step in when a decision requires human judgement. In bookkeeping, this usually means reviewing a few transactions that the agent cannot categorize on its own. When the user answers a question, the agent offers to save the answer as a rule or a prompt line, and saves it on the user's yes, so it does not ask the same question again. Because the agent handles the routine steps, the user does not need a traditional step-by-step interface.

We still keep the app screens so the user can open them whenever they want to inspect their data, check a balance, or make a manual edit. However, no screen exists just to advance the workflow.

## The person's flow

1. The user drops all their statements from any bank and any period, in any order, onto the Update screen, or points the agent to a folder.
2. When they click "Add N files to my books", the app opens their coding agent in a terminal.
3. The user reads Message 1, which lists the files they provided, what the agent will do, and the few details it needs before starting. They reply with their answers and tell the agent to go.
4. They can leave the agent running while it works.
5. They read Message 2, which summarizes their finances and batches all the questions the agent could not resolve on its own into a single round. They can reply using shorthand (for example, `ok`, `3b 4a`, or `rest skip`).
6. They read Message 3, which explains what to do next. From there, they can open Review to post the ready accounts, or ask the agent to post them.

When the user adds statements in a later month, they follow the same flow starting at step 1. Because the agent saved the previous answers they agreed to as rules, Message 2 is shorter.

## How dbu6 does it today

### The run

The run guide (`docs/run-guide.md`, printed by `npx dbu6 docs run`) is the one home for the run workflow. A run starts from one of the entry points listed in that guide's Entries:

| Starts from | In the app | Follows |
| --- | --- | --- |
| a pile of new statements | Update's drop zone, the first run's card: Add N files to my books (`run/inbox.ts`) | Phases 0–9 |
| the drafts already in Review | Review's Fix these, or an account's Overview with Fix these scoped to that account | "Starting from the drafts" |
| cash, deposits, investments, loans | Settings › Opening balances: Fill in what you own and owe | "Accounts with no statements" |
| a posted balance check that stopped matching | Reconciliation Differences: Find why this stopped matching | playbook `posted-balance-check` |
| a change to the chart | Accounts: Reorganize my chart | playbook `chart-change` |

The user can also skip the app and ask their agent directly. When a user says "do my books" or "here are my statements", `template/AGENTS.md` directs the agent to the run guide.

When starting from a pile of statements, the agent runs through these phases:

* **0. Preflight.** The agent checks the token, runs `npx dbu6 check`, and checks whether the app is running.
* **1. Survey.** The agent makes a single call to `/add-account/read` across all files to group them by account and identify any files that no parser reads. It also reads Home, the presets, the chart, and Overview, and decides whether this is the user's first run.
* **2. Plan gate: Message 1.** The agent does not write any data before the user says go.
* **3. Chart.** If the books have no chart of accounts, the agent creates one from the starter chart, excluding any accounts the user unchecked. The agent tailors this chart to the user's transactions in Phase 6.
* **4. Parsers.** Before importing any rows, the agent writes one parser for each statement format that no parser reads, or that several parsers read. A text file no parser reads is imported freeform instead, with no parser.
* **5. Accounts and imports.** For each account, the agent imports the oldest statement first.
* **6. Categorize, across all accounts at once.** After categorizing the transactions across all accounts, the agent tailors the chart of accounts to the imported data.
* **7. Clean-up.** The agent resolves duplicate rows and failing balance checks. Next, it resolves double-counted transfers as a separate, bounded task.
* **8. Question round: Message 2.** When the user answers the questions in Message 2, the agent saves those answers as rules, new accounts, one-off settings, and opening balances.
* **9. Report: Message 3.** The agent lists the next steps first, followed by a summary of what it changed.

Between these three messages, the agent prints only brief progress lines using plain, everyday terms. The messages do not mention internal concepts like parsers, presets, phases, playbooks, refusal codes, or API endpoints. When the user needs to understand a bookkeeping concept, the agent explains it once, the first time it comes up, using examples from the user's own data.

dbu6 does not store separate state for a run. Instead, the agent reads the current state directly from the books, including the presets, the drafts, and the rules in `user-config/`. If the user starts a new session with the same prompt, the agent surveys the books again and picks up where the previous session stopped. Also, dbu6 does not keep a log of the run, because a log would create an extra copy of the user's financial data.

### Permissions

The "Permissions inside a run" table in the run guide defines what the agent is allowed to do during a run:

* **Covered by "go" in Message 1:** Setting up the starter chart, writing parsers, creating presets for the planned accounts, adding and importing those accounts, recording opening balances printed on the statements, categorizing rows, writing rules for the rule requests the plan lists, deleting exact duplicates, and resolving double-counted transfers according to the playbook.
* **Asked in Message 2:** Creating new accounts, making chart changes requested by the user, categorizing the "needs your call" groups, each new rule or prompt line (one yes per rule), and setting opening balances for accounts that do not have statements.
* **Asked individually:** Modifying a posted journal entry, deleting any row that is not an exact duplicate or a double-counted transfer, changing an existing opening balance, and changing dbu6 itself (`statement_disagreement`).
* **Never allowed:** Changing a statement balance, deleting transactions just to make a balance check pass, editing files inside `node_modules/@dbu6/app`, or writing to the SQLite database directly.

By default, the user posts drafts to the books manually on the Review screen. The agent only posts drafts if the user explicitly asks it to, by calling `post-ready` or `post-to-journal` (as described under "Add them to my books" in the books guide).

### Where the screens stand

Every workflow screen puts the agent entry first and, where a manual path exists, a quiet link next to it for doing the task by hand.

| Screen | Agent entry | Manual path |
| --- | --- | --- |
| Update (`/update`) | the drop zone and Add N files to my books | Import statements, guided (`/import`), plus the cards on `/add` until anything is posted |
| Review (`/review`) | Fix these (across all remaining items) | Add all, or Add per account |
| Review › an account | Fix these on Overview, plus per-tab buttons for duplicates, balance checks, categorize, and rule requests | Drafts grid, Improve categorization, and Run categorizer |
| Import (`/import`) | per-file buttons for missing parser, ambiguous parsers, unresolved account, identifier, and refusal | running the import manually |
| Accounts | Reorganize my chart | editing one account at a time in a dialog |
| Settings › Opening bal. | Fill in what you own and owe | Record a balance by hand (`/add/other`) |
| Reconciliation Diff. | Find why this stopped matching | - |
| All reports | asking for a new report | - |
| Tools (`/tools`) | Import freeform transactions | Import statements, guided, plus the draft and books hledger views and the tables |

The code in `src/frontend` builds every prompt that an agent button sends to the terminal. To find all of them, run `grep -rn 'agentPrompt(\|runPrompt(' src/frontend`.

## Internals that decide designs

### Statements in, drafts out

* **The inbox.** When the user drops a file, `POST /api/statement-inbox` (contract in `statement-inbox.ts`) only saves it to `tmp/statement-inbox/`, and deduplicates identical files by byte content. Nothing is read or imported at the drop. The endpoints `/add-account/read`, `/add-account/add`, and `/import-draft/statements/auto` accept these files by path via the `inbox_files` parameter and read them directly from the inbox folder; `/import-draft/abacus` takes `inbox_files` for the file its rows were read from. If a request passes a file path outside the inbox, the endpoint returns `not_in_inbox`. An import deletes its own files from the inbox once their rows are in the drafts, and lists them in `inbox_files_imported`. Reads and refused imports leave them, so any files still in the folder are the ones that have not been imported yet. Files are told apart by path from drop to import (`DroppedFile`), so two files dropped with one name are still two files. `/api/statement-inbox/discard` deletes a file the person doesn't want imported; the agent never deletes a statement that went in.
* **Drafts.** Importing a statement writes one draft per statement row. All reports and all screens outside of Import and Review ignore drafts, so imported rows do not affect the books until someone posts them.
* **Categorizing.** During an import, the app first runs the JavaScript rules in `user-config/transaction_mappings.mjs`, and then runs the AI categorizer using each account's `custom_mappings_*.prompt` file. Each rule names the statement it reads (an account, a list, or `"*"` for every statement) and which way the money moved, and the rules read the row's statement as the AI does, so a rule never claims a row on a statement it doesn't name. A rule never answers with the row's own statement account; that row goes on to the next rule or the AI. `dbu6 check` fails on a rule for every statement whose account has statements of its own: a transfer rule names its side. Before proposing a rule, the agent runs it through the categorizer's own matching with `POST /api/categorization-rules/preview`, which answers what it catches per statement in the drafts and the books. This categorizer (`coding-agent/categorization-llm.ts`) invokes the coding agent's CLI headlessly using its cheapest model. Similarly, the starter chart's suggestion (`chart-llm.ts`) invokes the same CLI headlessly using its most capable model. These are the only headless agent calls. For all other agent tasks, `coding-agent/handoff.ts` opens an interactive terminal session so the user can watch the agent work.
* **Privacy.** No data leaves dbu6 except to the LLM provider configured by the user's coding agent.

### The balance check is the anchor

* The app attaches a statement's printed balance to the last draft row of that date. On each date, the running balance calculation (`reconciliation/running-balance.ts`) adds, in this order: the account's posted entries, then drafts on other accounts' statements that post to this account (`other_draft`), then the account's own drafts. If the result does not match the printed statement balance, the balance check fails.
* Because the calculation includes other accounts' drafts that post to this account, a transfer that appears on two bank statements will cause a balance check to fail while both copies exist in the drafts. To fix this, the agent follows the `double-counted-transfers` playbook to delete the second copy and blank only the balance checks that fail by the transfer's amount on the dates between the two sides of the transfer. We do not use a separate API endpoint or a special duplicate type for transfers.
* Calling `GET /api/accounts/:id/activity` returns the running balance row by row, matching how the balance checks add it up. Guides and playbooks always call this endpoint rather than duplicating its SQL query.
* If the agent or user deletes the draft row that holds a day's statement balance, a SQLite trigger (added in migration 0015) moves that statement balance to the new last draft row for that date.
* **Posting is a press** (`workflows/posting.ts`, using `decidePress` and `postPress`). When checking whether an account's balances match before posting, the app only counts other accounts' drafts if those other accounts are in the same press. Therefore, accounts that rely on each other must be posted together, in a single database transaction, or not at all; a press can still post some accounts and leave others. Calling `GET /api/review/accounts` returns `add_all` along with a `relies_on` list for each account so the caller knows which accounts must be posted together. If a press would cause any already-posted balance check to fail, the endpoint rejects the request with `POSTED_CHECKS_WOULD_FAIL` and posts nothing.

### Prompts, guides and playbooks

* **Guides.** Running `npx dbu6 docs <name>` prints the corresponding guide from `GUIDES` in `src/shared/guides.ts`. Because the guide files sit inside `node_modules` in a user's project, prompts and `AGENTS.md` always refer to a guide by its `npx dbu6 docs <name>` command rather than by its file path.
* **Playbooks.** Each playbook in `docs/playbooks/` (listed in `PLAYBOOKS` and printed via `npx dbu6 docs playbook <name>`) explains how to solve one specific problem. Both the full run and the individual buttons in the app point the agent to the same playbook file. Each playbook includes a "When" section that lists the refusal codes it handles, and a "Report" section that defines the headings the agent must use when reporting back.
* **Two prompt shapes.** The file `src/frontend/agent-prompt-rules.ts` defines two prompt builders:
  * `agentPrompt` builds a prompt for a single task. It passes the desired outcome, the facts for that specific case, and the playbook name. Under `PLAN_FIRST_RULE`, the agent must reply with a three-line plan before it reads any data.
  * `runPrompt` builds a prompt for a multi-step run. It passes the desired outcome, an optional scope (the files dropped, or the accounts), and the guide section where the agent should start (`RUN_SECTIONS`, which a test verifies against the guide's actual markdown headings). Under `RUN_PLAN_FIRST_RULE`, the agent must survey the books and reply with a plan before writing any data. Because the agent runs a survey at the start of the run, `runPrompt` does not include item counts in the prompt string.
* **Stable names.** Once we ship a guide or playbook, we do not rename it, because existing prompts and `AGENTS.md` files in user projects reference it by name.

## Judging a workflow

When you design or audit a screen, button, or workflow step, put it into one of three categories:

1. **Judgement.** These are decisions that only the user can make, such as explaining what a payment was for, deciding whether to create a new account, or providing an opening balance when there is no bank statement. The agent should batch these questions into a single round, show the relevant transactions, offer two to four options, and explain what happens if the user skips the question. Once the user answers, the agent offers to save the answer as a rule, and saves it on the user's yes.
2. **Advancing the workflow.** These are steps that move the data from one stage to the next, such as categorizing rows, settling duplicates, fixing balance checks, or configuring an account preset. The agent should run these steps automatically during a run. While a screen can keep a quiet manual link for users who want to do the task by hand, the user should never have to click a button just to start the next step.
3. **Looking at the books.** These are views that let the user inspect their finances, such as Reports, Overview, the summary counts on Review, and the Drafts grid. We keep these screens because they let the user see what is in their books and verify that the numbers are right.

Use these questions to evaluate any UI element or workflow step:

* If a button only exists to trigger the next step in a sequence, the run guide should have the agent take that step without it.
* If the agent can figure out the right action by reading the data, do not ask the user or show them a choice.
* If the agent must ask the user a question, make sure the agent batches it with the other questions in Message 2, and offers a rule for future runs that it writes only on the user's yes.
* If the agent gets stuck and cannot finish a task, it must explain the problem under the "Still open" heading in Message 3, rather than making the user open a screen in the app to discover the error.

Follow these rules when you change a workflow:

* **Keep each method in one place.** Put the instructions for solving a specific problem into its playbook. The run guide should only define the order of operations and link to the relevant playbooks. Similarly, a button's prompt in the app should only name the playbook, pass the facts for that specific case, and specify what the agent should do next (`next`). Never copy step-by-step instructions, rules, or report headings into multiple files.
* **Do not mention UI button labels in the guides.** Because agents interact with dbu6 through its CLI and HTTP API, they do not click buttons in the UI. Also, if you quote a button label in a guide, that text will go out of date when we change the screen.
* **Use bookkeeping terms, not internal code terms.** When the agent writes to the user, it should talk about accounts, months, and amounts, and leave out internal names like states, parsers, or refusal codes (see `UX-PRINCIPLES.md` and the "Talking to someone new" section in the run guide).
* **Send all statement uploads to the Update drop zone.** Whenever a screen needs a bank statement from the user, link them to the drop zone on the Update screen so there is only one place to upload files.
* **Put the manual path in a quiet link.** Place the manual link next to the primary agent button, and never make the manual path more prominent than the agent button.
* **Align values in columns.** Format numbers and tables into aligned columns so they are easy to scan, both in the web UI and in the agent's terminal messages.

Do not change any of the following design decisions without asking the repository owner first:

* Agents only start via an interactive terminal handoff, and the plan gate (Message 1 in a run, the three-line plan for a single task) is the only confirmation step. Do not add confirmation dialogs in the web UI, and do not add new headless agent calls.
* Keep the "Run categorizer" tab on the Review screen.
* Do not group transaction narrations together for bulk classification. Because bank reference numbers make almost every narration string unique, users and agents categorize transactions directly in the grid.
* Never alter a printed statement balance to make a balance check pass.
* Do not create extra copies of the user's financial data. Specifically, do not log agent runs to disk, and do not save copies of bank statements inside the project folder once they are imported.

## Where the old shape remains

The screens and buttons below still offer a way to advance the workflow by hand, beside the agent entry. We list them here as candidates for a later audit; we have not yet decided which ones to remove or change:

* `/import` (Import statements, guided) and the cards on `/add`. These provide a manual import path alongside the Update drop zone, with separate agent buttons for each type of file error.
* The per-tab agent buttons on Review (for duplicates, balance checks, categorizing, and rule requests), which sit alongside the main "Fix these" button that handles all of those tasks in a single run.
* Review › Run categorizer and Improve categorization. If a user leaves pending rule requests on these tabs, the agent converts them into rules during the next run from the drafts.
* Tools › Import freeform transactions. The run already imports plain-text transaction files freeform on its own.
