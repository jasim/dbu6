# Plan: layer the backend

`packages/api` is being reorganized into the tiers described in
[DEVELOPMENT.md → Backend layering](./DEVELOPMENT.md#backend-layering): value
types and statement arithmetic at the bottom, ledger storage above them, the
domain workflows in `workflows/`, and routes and reports in `app/` on top.
`packages/api/layering.test.ts` enforces the tiers. Its `KNOWN_VIOLATIONS` list
holds every import that breaks them today, tagged with the task below that
removes it.

This plan grew out of a layering review (summarised under
[Findings](#findings)) and is meant to be worked through in many separate
conversations. Each task's section is all a fresh conversation needs; none of
them depends on the history of the conversation that wrote this.

## Order

```
S1 → M0 → M1 → M2 → M3 → M4 ─┬─ A ────────────── D ──┐
                              ├─ B1 → B2 → B3 ────────┼─ F1 → F2
                              └─ C ───────────────────┘
```

- **M0–M4 run one after another.** Every move rewrites imports across the
  package, so two moves at once would edit the same import lines. Each is one
  conversation on its own branch, merged before the next begins. With the move
  tool from M0, each stays small.
- **After M4, A, B1 and C run in parallel**, each in its own worktree. D waits
  for A, since both change categorization's error. B2 and B3 follow B1 because
  they edit the same SQL.
- **F1 and F2 close the work.**

### Why no dynamic workflow

A multi-agent workflow script pays off when many independent, well-specified
jobs can run unattended. That isn't the case here:

- The move chain is sequential.
- The parallel wave has at most three tasks.
- Each task starts with a plan that waits for the owner's go-ahead, and two of
  them (B1, D) contain a decision only the owner can make. A background
  workflow can't stop and ask.
- Merging the parallel branches needs judgment.

Separate conversations give the same context isolation, with the owner in the
loop. F2, the closing review, is the one place a workflow could help (a
reviewer per tier, then a verifier per finding), if the owner opts in then.

### Conversations and subagents

- **A task as its own conversation** (the default): open a fresh conversation
  and use the start prompt below.
- **A task as a subagent:** a coordinating conversation may run a task through
  the Agent tool with `isolation: "worktree"` and the same start prompt. The
  subagent stops after its plan. The coordinator shows that plan to the owner,
  then continues the same agent with the go-ahead (`SendMessage`), and in the
  end reviews and merges the branch. The coordinator should keep only each
  agent's summary, not its file reads.
- **Tasks with a decision for the owner** (B1, D) are easier as their own
  conversations.

## How to work a task

Start prompt:

```
Do task <ID> in PLAN.md. Read "How to work a task" and the task's section,
then DEVELOPMENT.md "Backend layering". Reply with your plan and wait for my
go-ahead.
```

1. **Read only what you need:** this section, your task, DEVELOPMENT.md
   "Backend layering", CODING-PRINCIPLES.md, and the files your task names.
   The layering rules behind this plan are in
   `~/m/a/code/personal-skills/layering/LAYERING.md` on the owner's machine.
   Load the `sapporta` skill before changing API, auth or row-scoping code.
2. **Plan first.** Your first reply is your plan and the decisions you need.
   Touch nothing until the owner says go.
3. **Keep your context small.** Find usages with `grep` or an Explore
   subagent instead of reading whole folders. Move files, move declarations
   between files (`--symbols`), and route imports through a module's
   `index.ts` (`--through`) with `scripts/move-files.mjs`, never by editing
   imports by hand.
4. **Behavior stays the same unless your task says otherwise.**
   - The `dbu6-shared` contracts and the HTTP responses don't change, so the
     frontend needs no edits except its coding-agent prompts (step 6).
   - The existing tests are the proof. Don't change their expectations to make
     them pass; if one truly must change, say why in your status line.
5. **Stay in scope.** Anything else you notice goes under
   [Found along the way](#found-along-the-way), not into your diff.
6. **Done when:**
   - `pnpm typecheck` and `pnpm test` pass;
   - `layering.test.ts` passes, your task's `KNOWN_VIOLATIONS` entries are
     deleted, and every file you moved has its new path in the test's table;
   - DEVELOPMENT.md names the new paths of anything you moved;
   - what the coding agent reads is still right about what you moved or
     reshaped: its paths and its account of what lives where (see
     [Decisions](#decisions)). The move tool's closing list shows where
     old paths remain;
   - your task's **Status** line says done, in one or two lines, and names
     anything the next task must know.
7. **Git.**
   - Work on a branch named `layering/<task-id>`, and commit only when the
     owner asks.
   - Never stage the package-source switch: after `pnpm package-sources
     use:local`, `packages/*/package.json`, `pnpm-lock.yaml` and
     `pnpm-workspace.yaml` point at the local Sapporta, and the committed state
     must use npm (DEVELOPMENT.md → Sapporta packages).
   - Fixtures follow AGENTS.md's no-PII rules.
8. **A parallel task works in its own worktree:**
   `git worktree add ../dbu6-<task-id> -b layering/<task-id> main`, then
   `pnpm install` there. Before merging, rebase onto `main` and run the checks
   again.

## Tasks

### S1 — Tier map and layering test

**Status:** done (2026-09-18). DEVELOPMENT.md has "Backend layering";
`packages/api/layering.test.ts` checks it, with 13 known violations; this plan.

### M0 — Move tool, and typecheck everything

**Status:** done (2026-09-18). Move with `node scripts/move-files.mjs`,
`--dry-run` first. It doesn't move a file's tests (`x.*.ts`) or update
`layering.test.ts`, docs, or the frontend agent prompts that name backend
paths; it lists what's left. `tsconfig.json` now covers every `.ts` file.

Goal: moving a file or folder is one command that also rewrites every import,
so M1–M4 don't spend their context editing imports.

- Write `scripts/move-files.mjs <from> <to> [<from> <to> …]`, with paths
  relative to `packages/api`, each a file or a directory.
  - It uses the TypeScript language service's `getEditsForFileRename` over
    every `.ts` file in `packages/api` (tests included, not only what
    tsconfig includes) to rewrite relative imports, both in files that import
    the moved ones and inside the moved files.
  - It keeps the `.js` specifier style, applies the edits, then runs `git mv`.
  - `--dry-run` prints the planned edits without applying them.
- `packages/api/tsconfig.json` doesn't include `modules/` or `authz/`, so
  tests under `modules/` are never typechecked. Make it cover every `.ts`
  file in the package (for example `"**/*.ts"`, excluding `dist` and
  `node_modules`), and fix whatever type errors that reveals.
- Prove the tool on a real file and on a directory: move each and move it
  back, with `pnpm typecheck` green in between.
- Add the tool to DEVELOPMENT.md → Commands.

### M1 — Tiers 0–2

**Status:** done (2026-09-18). `modules/ledger-sql/`, `values/` and
`statement/` exist, each imported only through its `index.ts`. The move tool
gained `--symbols` and `--through` (DEVELOPMENT.md → Commands). Tests build
auth with `createTestAuthContext`, which only the linked Sapporta exports so
far: publish Sapporta's next release (0.8.0, with its pending changesets)
and pin it before dbu6 switches back to npm.
**Depends on:** M0. **Findings:** 2 (the type), 3, 4.

- **New module `modules/ledger-sql/`:**
  - Move `ledgerCtes`, `ScopeParams`, `allRows` and `oneRow` here from
    `app/reports/shared.ts`. The report column and link helpers stay behind.
  - Define `LedgerAuth = Pick<SapportaAuthContext, "rowSecurity">` and use it
    everywhere in place of `RowScopeAuth` from
    `bank-importer/draft-persistence.ts`. Delete `RowScopeAuth` and the cast
    in `app/workflow-auth.ts`.
  - Test fakes of `RowScopeAuth`, whose `ownedRows` returns the predicate
    unchanged, become `createTestAuthContext({ tables, workspaceId, userId })`
    from `@sapporta/server/testing`, which is real row security.
  - Leave `auth?` optional for now; B1 makes it required.
- **New module `modules/values/`:**
  - `bank-importer/domain/{Money,Account,Chrono}.ts`.
  - `normalizeIdentityText` and `transactionAmountMinor`, moved out of
    `modules/reconciliation/transaction-identity.ts`. They feed transaction
    keys: move them without changing a character, and the key tests must pass
    untouched.
- **New module `modules/statement/`:** `bank-importer/abacus/*` and
  `bank-importer/import-errors.ts`, whole (A splits it later).
- **Entry files:** each new module gets an `index.ts`, and its `entries` go in
  the layering test's table. Other modules import through it.
- **Removes** the five `M1` entries in `KNOWN_VIOLATIONS`.

### M2 — Tier 3

**Status:** done (2026-09-18). The five tier-3 modules are in
`modules/<name>/`, each imported through its `index.ts`. journal-plan's index
names its two `fromGroups` `planFromGroups` and `hledgerFromGroups`, and
`format` `formatHledger`, until C merges them. `resolveAccountIdForCategorized`
sits in `categorization/CategorizedTransaction.ts`. `JournalPlan.test.ts` lost
its `CategorizedDraft` type and the two fields `fromGroups` never read; its
expectations are unchanged. For M3: `--symbols` can leave misplaced `type`
modifiers (Found along the way).
**Depends on:** M1. **Findings:** 3, and the types of 6.

- **`modules/transaction-identity/`:** what remains of
  `transaction-identity.ts`, plus `journal-transaction-matcher.ts`.
- **`modules/categorization/`:** `bank-importer/categorization/*`,
  `domain/CategorizedTransaction.ts`, and `resolveAccountIdForCategorized`
  from `draft-persistence.ts`. It is pure; D reshapes it.
- **`modules/gpay/`:** `domain/GPayIndex.ts`.
- **`modules/journal-plan/`:** `domain/{TransactionGroup,JournalPlan,HledgerJournal}.ts`.
  Loosen their types so the module names neither categorization nor drafts:
  - `groupByDateAndType` takes any `{ transaction: Abacus }`;
  - `JournalPlan.fromGroups` takes rows that carry a numeric `accountId`;
  - C reshapes the rest.
- **`modules/statement-sources/`:** `statement-recognition.ts`,
  `import-presets.ts`, `auto-import-plan.ts`, and the parser tests in
  `bank-importer/parsers/`.
  - `importOptionsFromPreset` moves into `bank-importer/statement-import.ts`;
    M4 carries it into the workflow.
- Update the paths in DEVELOPMENT.md → "transaction_mappings.mjs" and "LLM
  prompts".
- **Removes** the five `M2` entries.

### M3 — Tier 4 and the coding agent

**Status:** done (2026-09-18). Tier 4 is in `modules/accounts/`, `journals/`,
`reconciliation/`, `drafts/` and `coding-agent/`, each imported through its
`index.ts`, and `KNOWN_VIOLATIONS` is empty. For M4: the checkpoint lookup is
in journals, the since-checkpoint filter in `reconciliation/since-checkpoint.ts`,
and two app tests mock `modules/coding-agent/categorization-llm.js`, which the
index re-exports.
**Depends on:** M2. **Findings:** 3, 4, and the co-location half of 5.

- **Decision for the owner, at the go-ahead:** add an `accounts` module at the
  bottom of tier 4 (accounts < journals < reconciliation < drafts) for the
  account lookups `loadAccountsByName` (`draft-persistence.ts`) and
  `loadLedgerAccounts` (`app/account-standing.ts`)? The approved map has no
  home for them; the alternative is `journals`. If approved, add it to the
  DEVELOPMENT.md table.
- **`modules/journals/`:** add `lookupLastReconciled` (from
  `draft-persistence.ts`) and `loadLastReconciled` / `LastReconciledRow` (from
  `app/reports/last-reconciled.ts`; the report keeps its rendering). The two
  sit side by side here; B2 merges them.
- **`modules/reconciliation/`:** add `newTransactionsSinceReconciliation` and
  `BALANCE_EPSILON` (B3 unifies the tolerance).
- **`modules/drafts/`:** the rest of `draft-persistence.ts`,
  `app/draft-categorization.ts`, `app/draft-status.ts`, and
  `domain/DraftCategorizedTransaction.ts`.
- **Tests move to their modules:**
  - the `toDraftRows` case in `abacus/Abacus.test.ts` goes to drafts;
  - the "draft reports narrowed to one account" block of
    `app/draft-status.test.ts` goes to a test beside those reports in
    `app/reports/`.
- **`modules/coding-agent/`:** `coding-agent/*`. Update `boot.ts` and the
  table in DEVELOPMENT.md → "LLM engine".
- **Removes** the three `M3` entries. Afterwards `bank-importer/` holds only
  the statement-import files.

### M4 — `workflows/` and thin routes

**Status:** todo. **Depends on:** M3. **Findings:** the posting-in-route
item.

- **`workflows/statement-import/`:** `statement-import.ts`, `draft-import.ts`
  and `pipeline.ts`, plus `importOptionsFromPreset`. Fold `draft-import.ts`
  and `pipeline.ts` into the workflow where they only pass calls through. It
  has three entry points:
  - **One account's statement:** today's `runStatementImport`.
  - **The automatic batch**, taken out of
    `app/import-draft-statements-auto.ts`. It recognizes the staged files and
    plans them. If the plan rejects, it stops. Otherwise it imports group by
    group, stops at the first failure, and says what was already imported. It
    returns a domain outcome.
    - The route keeps multipart parsing, staging and keeping uploads
      (`upload-tmp.ts`), and builds the wire body from the outcome.
    - Until A lands, the workflow may still catch `ApiImportError` per group.
  - **Freeform transactions**, taken out of `app/import-draft-abacus.ts`: the
    account-exists check, the declared-balance check, and the import.
- **`workflows/posting.ts`:** `postDraftsToJournal`, moved out of its route
  file. It returns an outcome: not found, blocked by a posting check, or
  posted. The route builds the 404/422/200 bodies, and `refusal()` stays in
  the route.
- **`workflows/reclassification.ts`:**
  `modules/draft-transactions/classification.ts`.
- **Cleanup:**
  - delete the emptied `bank-importer/` and `modules/draft-transactions/`;
  - delete the "older folders" paragraph in DEVELOPMENT.md;
  - fill in the workflow modules' paths in the layering test's table.
- **Proof:** `import-draft-statements-auto.test.ts`,
  `import-draft-abacus.test.ts` and `post-drafts-to-journal.test.ts` pass with
  only their imports changed.
- **Done also means** `KNOWN_VIOLATIONS` is empty.

### A — Translate errors at the edge

**Status:** todo. **Depends on:** M4. **Runs alongside** B1 and C.
**Findings:** 1, and the test-only copy.

- **Domain errors only.** Each module throws its own errors, carrying domain
  fields and no `status` or `toPayload()`:
  - the statement errors stay in `modules/statement`;
  - `ReconciliationMatchError` and `AmbiguousDuplicateError` go to
    reconciliation;
  - `AssertionConflictError` goes to drafts;
  - `CategorizationConfigError` goes to categorization. A owns this class; D
    leaves it alone.
- **No hint prose in errors.** `BalanceMismatchError` carries
  `suspectedGap: boolean` instead.
- **One translator.** `app/import-error-response.ts` turns an error into a
  status and a `StatementImportError` body, keeping the original as `cause`.
  - The hint texts are written there.
  - Both classify routes use it, replacing `err.status === 400`.
  - The batch workflow stops on a domain error type, not on `ApiImportError`.
- **Remove advice from lower-layer messages,** including the stale mentions
  of "opening_balance in the request" and "an opening balance override";
  neither exists.
- **Delete test-only code.** `computeRunningBalances`,
  `normalizeExtractedTransactions` and `analyzeDateOrder` go, with their
  tests, once `grep` confirms nothing but tests calls them.
- **Contract.** `statementImportErrorSchema` doesn't change. Bodies stay the
  same except the reworded `message` and `hint` text. Add a translator test
  for each error code.

### B1 — One row-scoping mechanism

**Status:** todo. **Depends on:** M4. **Runs alongside** A and C.
**Findings:** 2.

**Decision for the owner, at the go-ahead:** how raw SQL gets Sapporta's
scope. Sapporta's own guide forbids filtering `workspace_id` and
`scoped_to_user_id` by hand, which `ledgerCtes` does today.
- **(a)** Render `rowSecurity.forTable(t).ownedRows()` with Drizzle's SQLite
  dialect into each `scoped_*` CTE. better-sqlite3 binds the positional
  parameters beside the named ones.
- **(b)** Run the report SQL through Drizzle's `sql` template, which composes
  `ownedRows()` directly.
- **(c)** Add a scoped-relation helper to Sapporta, in the linked checkout,
  and publish it before dbu6 commits, because dbu6's committed state uses npm.

Then:
- `ledgerCtes` stops writing the workspace/user filter.
- One scope helper replaces `requireWorkflowScope` (`app/workflow-auth.ts`)
  and the reports' `workspaceUserScope`. Posting's ledger then needs one scope
  instead of both `auth` and `scope`.
- `auth` becomes required everywhere: drop `auth?` and the unscoped
  `access ? … : …` branches.
- Tests use `createTestAuthContext`. Add one test proving another user's rows
  never show up in draft status, in a report, or in a checkpoint.
- **Touches:** `modules/ledger-sql`, every report in `app/reports/`, drafts
  status, `modules/journals`, `modules/reconciliation` (only if CTE names
  change), `app/workflow-auth.ts`, `workflows/posting`.

### B2 — One checkpoint query

**Status:** todo. **Depends on:** B1. **Findings:** 5.

- Keep one query in `modules/journals` for the last reconciled checkpoint:
  for every account, or for one by id.
- Use it from three places: the statement-import workflow (by account id, no
  longer by name), account standing, and the last-reconciled report.
- Pin the tie-break with a test: latest date, then journal id, then entry id.
  Say in the status line if an edge case now picks a different checkpoint.

### B3 — One balance-check rule

**Status:** todo. **Depends on:** B2, which edits the same SQL.
**Findings:** 7.

- A module in `modules/reconciliation` owns three things:
  - the tolerance within which an assertion holds (today `0.005` in
    `draft-persistence.ts`, the running-balance SQL, and the
    balance-assertions report);
  - the order of drafts within a day, both as an SQL fragment and as a
    Drizzle `orderBy`;
  - the rule that a day's assertion sits on that day's last draft.
- Everything that relies on these imports them: draft placement, loading and
  the closing query, the running-balance SQL, draft status, and the
  balance-assertions report.
- Decide whether `ANCHOR_EPSILON` (used when joining statement parts) is the
  same fact. If it isn't, say so in a comment where it is defined.

### C — One journal plan

**Status:** todo. **Depends on:** M4. **Runs alongside** A and B1.
**Findings:** 6, and the balance-field half of 7.

- **One `fromGroups`** in `modules/journal-plan` builds a plan.
  - Its account reference is generic: an id when posting, a name when
    rendering.
  - Amounts are numbers, not strings.
  - A group's closing assertion comes from an explicit field, not from the
    statement row's `balance`. Today the drafts loader puts the assertion into
    `balance`.
- **One hledger formatter** renders a plan. `modules/journals` renders posted
  journals with the same line formatter. HledgerJournal's own `fromGroups`
  goes.
- **Every journal comes from the plan:** the draft preview
  (`app/render-draft-hledger.ts`), the import summary's `hledger_journal`,
  and posting.
- **Tests.** Add one showing that, for the same drafts, the preview equals the
  rendering of what posting writes. Existing hledger output stays
  byte-identical.
- **Touches:** `modules/journal-plan`, the formatter in `modules/journals`,
  the drafts loader, `workflows/posting`, the summary in
  `workflows/statement-import`, `app/render-draft-hledger.ts`.

### D — Categorization owns its answer

**Status:** todo. **Depends on:** A. **Findings:** 8, 9, and the LLM
interface items.

**Decision for the owner, at the go-ahead:** should the LLM choose from the
`accounts` table instead of from `hledger_accounts.prompt`? Today an account
named in the prompt but missing from the table silently leaves the row
uncategorized. The change alters what the LLM sees and retires a user-config
file.

Then:
- **Two levels in `modules/categorization`.** The top level loads
  `transaction_mappings.mjs` and the prompt files once per request
  (`loadCategorizer`). Below it, pure categorization takes what was loaded and
  returns an account id or none for each row, applying the same-account rule,
  plus the report.
- **One path for import and reclassification.** Both call the same function.
  Drafts store the ids they are given; `toDraftRows` no longer looks up
  names.
- **GPay.** Workflows parse the Takeout once (`parseGPayHtml`) and pass the
  index down. Below its top level, `modules/gpay` takes no file paths.
- **The LLM interface.** `reportedError` moves into the coding-agent adapter,
  so categorization receives errors already fit to show.
- **Duplicates.** Delete the backend copy of `sameAccountSkipSchema`; the
  contract owns it.
- **Docs.** Update DEVELOPMENT.md → "LLM prompts" and "transaction_mappings.mjs".

### F1 — Tighten the test

**Status:** todo. **Depends on:** everything above.

- `KNOWN_VIOLATIONS` is empty. Keep the mechanism for future moves.
- Every module declares `entries`.
- Add package rules per tier:
  - tiers 1–3 import no `drizzle-orm`, `better-sqlite3`, `hono` or
    `@sapporta/server`;
  - `node:fs` and `node:child_process` appear only in the named top files of
    statement-sources, categorization and gpay.
- Make the DEVELOPMENT.md table final.

### F2 — Independent layering review

**Status:** todo. **Depends on:** F1.

A fresh agent, given `LAYERING.md` and `packages/api` but not this plan or the
earlier review, reviews the backend's layering. Its findings become new tasks
here or get fixed. If the owner opts in, this can run as a multi-agent
workflow: a reviewer per tier, then a verifier per finding.

## Findings

From the layering review of 2026-09-18. Paths are as they were then; M1–M4
move most of them.

1. **Errors carry HTTP status and API payloads from the lowest layer.**
   - `ApiImportError` (`bank-importer/import-errors.ts`) has an HTTP `status`
     and a `toPayload()`.
   - It is thrown from `abacus/balances.ts`, `abacus/assemble.ts`,
     `abacus/Abacus.ts` and `draft-persistence.ts`, and categorization's
     `CategorizationConfigError` extends it.
   - The routes only pass it on, and the classify routes check
     `err.status === 400`.
   - The messages carry advice, some of it stale:
     - "Provide opening_balance in the request" and "an opening balance
       override" describe features that don't exist;
     - `resolve.ts` tells an HTTP caller to run `pnpm setup`.
2. **Row scoping exists twice.**
   - Drizzle code uses `auth.rowSecurity`. Raw SQL uses `ledgerCtes`
     (`app/reports/shared.ts`), which filters workspace and user by hand.
   - Two helpers extract the scope: `requireWorkflowScope` and the reports'
     `workspaceUserScope`.
   - Posting needs both mechanisms (`PostingLedger` holds `auth` and `scope`).
   - `RowScopeAuth` is an `any`-typed copy of a type Sapporta exports, cast
     into place, and optional, so an unscoped import is a supported mode.
3. **`bank-importer/` and `modules/` form cycles.**
   - `draft-persistence` ↔ `duplicate-store`.
   - `abacus/assemble` → `transaction-identity` → `abacus`.
   - The journals renderer, reclassification and the auth guard import the
     statement importer's persistence file just for the auth type.
4. **Lower code relies on report-layer names.**
   - `running-balance.ts` and `duplicate-diagnostics.ts` query `scoped_*`
     CTEs that only `app/reports/shared.ts` defines, and a lower test imports
     that report file.
   - `app/draft-status.ts` and `app/account-standing.ts` import from report
     modules.
5. **The last reconciled checkpoint is computed twice.**
   - `lookupLastReconciled` (Drizzle, by account name) filters the import's
     rows.
   - `loadLastReconciled` (raw SQL, by id) is what Home and Review show.
6. **The journal shape and its hledger text live in three places.**
   - `JournalPlan.ts` says it "mirrors HledgerJournal.fromGroups";
     `HledgerJournal.ts` builds the same shape as text; `modules/journals/hledger.ts`
     repeats the line layout.
   - So the preview, the import summary and the rendering of posted journals
     come from different code.
7. **The draft balance-check rule is spread over four files.**
   - The assertion is placed on the highest-id draft of the day, justified by
     the report's algorithm.
   - The order of drafts within a day is written separately in three places.
   - Posting reads the assertion through the statement row's `balance` field.
   - The `0.005` tolerance is repeated in three places.
8. **Categorization policy lives in draft persistence.**
   - The same-account rule and the name → id lookup sit in
     `draft-persistence.ts`, and reclassification reaches in for them.
   - `sameAccountSkipSchema` is declared again in the backend.
   - The account list lives both in `hledger_accounts.prompt` and in the
     `accounts` table, matched by exact name.
9. **Config and file reads happen inside the engine.**
   - Categorization reads the user's files on every call and knows their
     names.
   - `GPayIndex.ts`, in the value-types folder, reads the Takeout file.

**Smaller items:**
- The LLM interface carries `agent: CodingAgent`, and categorization cleans up
  a gateway's HTML error pages (`reportedError`), which is the adapter's job.
- Some comments describe higher layers and are stale, such as `assemble.ts`
  mentioning "the selected preset".
- `computeRunningBalances` and two siblings run only in tests, and duplicate
  `runStatementImport`'s logic.
- Posting lives in its route file.

**Already sound, keep:**
- Categorization declares `CategorizationLlm` and `coding-agent/` supplies it.
- `postingBlocks` in `dbu6-shared` is the one place that decides whether
  drafts can be posted.
- `planAutoImport` is pure.

## Decisions

- 2026-09-18: the tier map in DEVELOPMENT.md is approved. Domain workflows
  live in `packages/api/workflows/`, a tier of their own, separate from
  `modules/`. `bank-importer/` and `coding-agent/` become modules.
- 2026-09-18: every task keeps what the coding agent reads accurate, so the
  features built on it keep working. When a task moves or reshapes backend
  code, it updates the paths and the account of what lives where in:
  - the prompts in `packages/frontend/src/views/import-statements/agentPrompts.ts`
    and `packages/frontend/src/review/agentPrompts.ts`;
  - in `custom-built-parsers/`: `README.md`,
    `import-statement-parser-guide.md`, `shared/abacus.py` and each parser's
    `fingerprint.md`;
  - `user-config.example/transaction_mappings.mjs`.
- 2026-09-18, M3: tier 4 gains `accounts` at its bottom (accounts < journals
  < reconciliation < drafts) for the account lookups, and every tier-4 module
  declares its `index.ts` as its entry.

## Found along the way

Things noticed during a task but outside its scope. Add them here with the
date and the task.

- 2026-09-18, M0: `a3a9583` ("UI improvement") committed the local Sapporta
  switch: `link:` paths to `/Users/jasim/…/sapporta` in the three
  `package.json` files, `pnpm-lock.yaml` and `pnpm-workspace.yaml`.
  DEVELOPMENT.md says the committed state uses npm.
- 2026-09-18, M0: on `main` since `a3a9583`, the frontend test
  `describeProblems.test.ts` › "turns an unrecognised file into a plain card
  with a parser-building prompt" fails: it expects "The AI agent shows you its
  plan before it writes one." in the problem's context.
- 2026-09-18, M0: the frontend's agent prompts
  (`views/import-statements/agentPrompts.ts`, `review/agentPrompts.ts`) name
  backend files that M1–M4 move, which would be a frontend edit that "How to
  work a task" step 4 doesn't expect. So do `custom-built-parsers/README.md`,
  `import-statement-parser-guide.md` and `shared/abacus.py`. Decided: tasks
  update them ([Decisions](#decisions)).
- 2026-09-18, M0: `modules/reconciliation/transaction-identity.test.ts` ("keeps
  distinct HDFC fee rows…") uses non-round amounts such as `100.25` and `9.09`,
  against AGENTS.md's fixture rules. M1 must leave the key tests untouched, so
  fixing it is a separate change. (Since M2 the test is in
  `modules/transaction-identity/`.)
- 2026-09-18, M2: when TypeScript's "Move to file" refactor, which `--symbols`
  runs, adds a value import to an existing `import type { … }`, it puts the
  `type` modifiers on the wrong names, as in
  `import { type accountKindOf, AccountKind }`. The tool's own merge isn't at
  fault, and it reports the resulting errors, which are quick to fix by hand.
  The tool could rewrite such imports itself.
- 2026-09-18, M3: `custom-built-parsers/federal-bank-xls/fingerprint.md` and
  `hdfc-bank-xls/fingerprint.md` name `packages/api/bank-importer/parsers/`
  `federal-bank.ts` and `hdfc-bank.ts`, which don't exist.
- 2026-09-18, M3: `--symbols` has two more quirks. The file it creates imports
  other modules' files directly rather than through their `index.ts` (and
  `formatPlainDate` from `@sapporta/shared` rather than
  `@sapporta/shared/temporal`), and a file's leading comment travels with the
  first declaration moved out of it. Both are quick to fix by hand.
