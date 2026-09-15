# PLAN — dbu6 redesign ("Quiet Ledger, neutral")

**Status:**
- **Done:** Step 1, the audit (§6), 2026-09-14. Step 2, the foundation (§7), 2026-09-15.
- **Decided 2026-09-15:** every decision in §5. D2, D3, D5's generic primitives, D6 and D7
  were adopted as proposed when the owner started implementation.
- **Branches:** dbu6 work is committed on `hdfc-bank-xls-parser` (the owner's choice; `main`
  holds only the initial commit). Sapporta's `dbu6-redesign` was merged into its `main`
  (seen 2026-09-15); the Sapporta checkout is on `main`.
- **Done:** Step 3, the app shell (§8), Step 4, Sapporta's surfaces (§9), and Step 5,
  dbu6's components and cleanup (§10), all 2026-09-15.
- **Done:** Step 6, P0, P1 and P2 (§11), each spec agreed and built 2026-09-15. P3
  (Review), spec agreed 2026-09-15 and built 2026-09-16.
- **Next:** Step 6, P4 (Income & expenses): prepare the discussion with the owner.

This file stands on its own. A coding agent should be able to pick up any step using only
this file, the two repositories, and (when it is on disk) the design handoff folder. You do
not need the conversation that produced it.

---

## 0. How to use this plan (read first)

**Rules for any agent picking up a step**

1. **Find your step** (§7–§11) and check its **Prerequisites**. If a prerequisite step isn't
   finished, or a decision it depends on (§5) is still *Proposed*, stop and ask the project
   owner. Don't pick the recommendation yourself.
2. **Read §1–§4 before touching code.** They cover why we are doing this, how dbu6 and
   Sapporta fit together, and the design language.
3. **Steps 2–5 are theming only.** They must not change page layouts, copy, routes, the
   navigation items, or behaviour. If a theming change seems to need a layout change, write
   it down as a follow-up.
4. **Step 6 changes layouts, one page at a time.** Only build a page once its spec has been
   agreed with the project owner and written into §11. The handoff's screens are a starting
   point for that discussion. Don't port them one-for-one.
5. **Keep Sapporta generic, and keep its modules deep.** Sapporta is a library other apps
   use. Change it for:
   - bug fixes;
   - tokens where one name controls many places;
   - gaps in behaviour its primitives should already cover.

   **Don't add props, slots or tokens that map one-for-one onto a single component's markup.
   Inline that component into dbu6 instead** (the depth rule, D1). dbu6's palette, fonts,
   copy and category hues stay in dbu6.
6. **Keep this file current.** Tick checkboxes as you finish tasks. Add an entry to the
   progress log (§13) with the date, the step, what changed, and any deviations or new
   findings. Correct this plan if the code disagrees with it.
7. **Stay in scope.** List follow-ups in the progress log instead of doing them.
8. **Where to find detail.**
   - The handoff folder (§3), when present, is the source of pixel-level detail.
   - This file decides scope, decisions and order.
   - If the two disagree on a value, the handoff wins, unless §5 or §4.10 says otherwise.

**Order of steps and what can run in parallel**

```
Step 1 Audit (done)
   │
   ▼
Step 2 Foundation ──────────┬─────────────────┬────────────────────┐
   │                        │                 │                    │
   ▼                        ▼                 ▼                    │
Step 3 App shell       Step 4 Surfaces   Step 5b dbu6 components   │
(dbu6-owned, D4)       (Sapporta)             │                    │
   │                        │                 ▼                    │
   │                        │            Step 5a token cleanup ◄───┘
   │                        │                 │
   └────────────────────────┴────────┬────────┘
                                     ▼
Step 6 · P0 Navigation & routes → P1 … P9 (one page per agreed spec)
```

- Steps 3, 4 and 5b can run in parallel once Step 2 is merged.
- Step 5a (cleaning up existing dbu6 pages) needs Step 2, plus 5b's dbu6 `Button` for
  replacing hand-rolled buttons.
- 5b's domain components reuse Sapporta's Checkbox, Popover and Dialog. Those pick up Step
  4's sizing automatically when it lands.

**Files that parallel steps both edit.** Add to them in the marked sections below; don't
reorganise them.

- **`dbu6/packages/frontend/src/app.css`.** Step 2 creates these sections and later steps
  add to them:
  1. 2a palette → Sapporta tokens
  2. 2a extra tokens
  3. `@theme inline` (fonts, type, heights, radii, shadows)
  4. Base rules
  5. Shell (Step 3, only what the shell components' own classes can't express)
  6. Grid and tables (Step 4)
- **`dbu6/packages/frontend/package.json` and `vite.config.ts`.** Step 3 and Step 5b may
  both add dependencies and single-copy aliases (§2.3).
- **`sapporta/packages/ui/src/index.css`.** Step 2 changes token wiring. Step 4 adds any new
  tokens under clearly labelled comments.

**Screenshots.**
- **Baseline "before" screenshots already exist** in
  `/private/tmp/claude-501/-Users-jasim-m-a-code-dbu6/7499e42b-f584-45a1-bb7c-2f5c1a034b42/scratchpad/dbu6-screenshots`.
  §6.7 lists them. Use them as the reference for how each screen looked before the redesign.
  Don't overwrite or add files there.
- **New screenshots** go in `dbu6/tmp/redesign/<step>/` (git-ignored). This covers after
  screenshots, and before screenshots for routes the baseline doesn't include.
  - Reuse the baseline file name when the route matches (e.g. `01-welcome.png`).
  - Otherwise use `<route-slug>.png`.
  - Add `-390` for mobile width.

---

## 1. Goal and background

### The product
dbu6 is a self-hosted personal-finance app for everyday people managing household money.
- **Double-entry books underneath.** Every transaction is a journal entry between two
  hledger-style accounts, such as `assets:bank:hdfc-savings` and `expenses:food:groceries`.
- **Statement import.** Users import bank and credit-card statements (PDF/XLS/CSV). Deterministic
  parsers in `custom-built-parsers/` recognise the layout and match each file to an account.
- **Categorisation.** Imported rows become *drafts*, which rules and an LLM categorise.
- **Posting.** The user checks categories, duplicates and statement balances, then *posts*
  the drafts into journals.
- **Reports.** Balance sheet, income statement, account ledger, net worth over time, and others.

### The problem the redesign solves
The current UI shows the bookkeeping directly:
- a 20-link sidebar grouped by accounting steps;
- accounting jargon everywhere ("post", "journals", "ledger", "revenue", "balance assertions");
- categories shown as blue monospace colon paths (`expenses:food:food-delivery`);
- a raw spreadsheet for reviewing imports;
- a flat income statement of about 60 rows, with no charts.

### What the redesign does
The handoff (§3) keeps every capability and changes what the user sees:
- plain language;
- **one obvious next step per screen**;
- a 5-item sidebar, with the power tools moved behind one "All tools" page;
- friendly category names, each with a colour;
- money always shown with a sign, an IN/OUT label and tabular figures;
- reports that lead with a summary and a chart, with the detail one click away.

The target direction is **option 2a, "Quiet Ledger, neutral"**:
- a pure white background and cool neutral greys;
- a calm green for primary actions and money coming in;
- blue only for "this needs you";
- red only for real problems.

### How the project owner wants to do it
1. **Apply the design language to the whole app first**: colour, typography, spacing, radii,
   controls. That includes the parts Sapporta supplies (app shell, sidebar, data grid, table
   and report pages, forms, dialogs, sign-in screens). Change Sapporta where needed.
   These are Steps 2–5.
2. **Then go page by page.** For each page, first discuss with the owner the ideal layout,
   arrangement, flow and UX. Then redesign it, based on this design language and that
   conversation. The handoff's layouts inform the discussion; they are not copied exactly.
   This is Step 6.

---

## 2. The codebases

### 2.1 dbu6 (`/Users/jasim/m/a/code/dbu6`)

**Layout.** A pnpm workspace:
- **`packages/api`**
  - Hono backend on `@sapporta/server`.
  - Tables in `packages/api/schema/` (Sapporta `sapportaTable`).
  - Custom endpoints in `packages/api/app.ts` and `packages/api/app/`. `app/home.ts`
    serves `GET /home` (the `homeContract` in `dbu6-shared`); `app/review.ts` serves
    `GET /review/accounts` and `/review/accounts/:accountId` (`reviewContract`, since P3).
  - `app/draft-status.ts` (since P3) is the one source for what blocks posting drafts:
    counts, dates, closing balance, failing balance checks and possible duplicates per
    account. Home, Review, the posting gate (`app/post-drafts-to-journal.ts`) and the two
    draft reports read it. `app/account-names.ts` names accounts from import presets.
  - Reports in `packages/api/app/reports/`. They return a `GridDataset` (grid-shaped rows,
    not domain JSON).
- **`packages/shared`**: ts-rest contracts, imported as `dbu6-shared`.
- **`packages/frontend`**: Vite 8, React 19, React Router 7, Tailwind 4.3, `lucide-react`. No shadcn.
- **`custom-built-parsers/`**: Python statement parsers.
- **`scripts/`**: dev, setup and seed scripts.

**How the frontend is put together**
- **`src/main.tsx`** loads `app.css`, then renders `SapportaApp` in a `BrowserRouter`.
- **`src/SapportaApp.tsx`** defines the route tree. Protected routes render inside
  `BootLoader` → `AuthGate` → `AppShell` (from `@sapporta/frontend/app`), with
  `navigation={appNavigation}` and `showFrameworkNavigation={false}`.
- **`src/App.tsx`** holds:
  - `appNavigation`: five everyday items (Home `/`, Accounts `/accounts`, Import statements
    `/import`, Review `/review` with the badge, Reports `/reports`) and one more (All tools
    `/tools`), since P0;
  - the index route (`/` renders Home, protected);
  - dbu6's routes, including the tool screens under `/views/*` and `/tables/journals`.
- **`src/redirects.tsx`** maps the retired paths (`/welcome`, `/advanced`,
  `/tables/accounts`, `/views/import-statements`, `/views/post-drafts`) to their new routes,
  keeping search and hash. `redirects.test.tsx` walks the table. `/tables/draft_transactions`
  is Sapporta's raw table again since P3.
- **`src/shell/`** is dbu6's app shell (D4): `AppShell`, `Sidebar` (sidebar and bottom
  bar), `navigation.ts` (the `{ everyday, more }` shape and the badge), `navigation-counts.ts`.
- **`src/reports/registry.tsx`** lists the twelve reports with their everyday and accounting
  cards; `ReportsIndex.tsx` (the `/reports` page) and `Advanced.tsx` (`/tools`) read it.
- **`src/SapportaRoutes.tsx`** holds the framework routes: sign-in and sign-up screens,
  `/account/profile`, `/workspace/settings`, `/tables/:tableName`, `/tables/:tableName/new`,
  `/setup/:tableName/new`, and not found.
- **Page frames.** dbu6 pages use one of five:
  - `Screen` and `ScreenTitle` (`src/components/screen.tsx`, since P2): no header bar, the
    title at the top of a scrolling centred column (`wide` 1040px for Home, `narrow` for
    Import, freeform import and the Review picker), clear of `--sap-page-header-inset`;
  - Review's account frame (`src/review/ReviewAccount.tsx`, since P3): the account's title
    and a tab bar at the top, full width; Overview and the report tabs scroll with it, the
    Drafts grid scrolls inside it;
  - `AppPage` (`@sapporta/frontend/shell`): page frame, 52px header bar, scrolling body;
  - `ReportScreenFrame` + `ReportToolbar` + `ReportGridDataset` (`@sapporta/frontend/report`);
  - `SchemaTableGridView` (`@sapporta/frontend`): the Sapporta data grid bound to a table.
- **Pages:**
  - `src/home/Home.tsx` (Home, P1; `home/state.ts` picks the greeting and card),
    `src/Advanced.tsx` (All tools until P5), `src/reports/ReportsIndex.tsx`
  - `src/review/*` (Review, P3): `ReviewAccounts.tsx` (`/review`), `ReviewAccount.tsx` (the
    account frame and tabs), `Overview.tsx` (`overview-state.ts` decides what it says),
    `DraftsTab.tsx`, `DuplicatesTab.tsx`, `BalanceChecksTab.tsx`, `agentPrompts.ts`, `routes.ts`
  - `src/views/*`: import statements, freeform import, reclassify, render hledger, journals
  - `src/reports/*`: 12 report screens plus `registry.tsx`
- **`src/app.css` is the only CSS entry point.** Order: `@import "tailwindcss"` →
  `@sapporta/ui/index.css` (tokens) → `@sapporta/grid/index.css` → `@sapporta/frontend/index.css`
  → `@source "./"` → dbu6's own rules (currently none).
- **Styling today is mixed:**
  - Sapporta token utilities (`text-sap-body`, `bg-sap-surface`);
  - shadcn aliases (`text-muted-foreground`, `bg-primary`);
  - Tailwind defaults (`text-sm`, `text-green-600`);
  - arbitrary values (`text-[34px]`).

**Data you'll meet in the UI**
- **`accounts`**: `name` is an hledger path, `account_type` is Asset/Liability/Equity/Revenue/Expense,
  and `parent_id` forms a tree.
- **Seeded top-level expense groups:**
  - `housing`, `utilities`, `food`, `transport`, `insurance`, `health`
  - `personal`, `shopping`, `subscriptions`, `entertainment`, `travel`
  - `child`, `family`, `giving`, `education`, `taxes`, `finance`
- **Seeded income groups:** `salary`, `interest`, `dividends`, `rewards`.
- **`draft_transactions`**: `date`, `narration`, `withdrawal`, `deposit`,
  `account_id` (the category; null means uncategorised), `base_account_id` (the bank or card
  being imported).
- **Posting** runs per `base_account_id` and creates `journals` and `journal_entries`.
- **Today's workflow:** add accounts → check the import checkpoint → import statements →
  review drafts (categorise, duplicates, balance assertions) → post → reports.

**Commands** (from the dbu6 root)
- `pnpm dev`: backend and frontend in watch mode.
  - Frontend: `http://localhost:2340`. API: `:2345`.
  - Ports come from `mise.local.toml` / `mise.toml`.
  - `/api/*` is proxied to the API.
- `pnpm seed [YYYY-MM-DD]`: run while `pnpm dev` is running. Creates a demo login holding a
  year of sample finances, with the current month left as drafts. The credentials are in the
  header of `scripts/seed-sample-data.mjs`.
- Checks: `pnpm typecheck`, `pnpm test`, `pnpm format`.

**Conventions**
- **`AGENTS.md`: no personal data** in tests, fixtures, docs or comments. Use round amounts,
  numbers containing `050505`, and `sample`/`NOPII` text.
- **`CODING-PRINCIPLES.md`:** an abstraction must reduce total complexity; one authoritative
  source per rule; modules organised around domain types.
- **`DEVELOPMENT.md`:** rebuild Sapporta before typechecking dbu6.

### 2.2 Sapporta (`/Users/jasim/m/a/code/sapporta`)

**What it is.** A library for building database apps. The rule from its `AGENTS.md`:
"Every part of Sapporta must be overridable, extensible, or skippable". High-level features
are composed from primitives that apps can also use.

**Packages this redesign touches** (dependency direction: frontend → grid → ui; `ui` imports
nothing else in the workspace)

| Package | Path | What matters here |
|---|---|---|
| `@sapporta/ui` | `packages/ui` | **Tokens** in `src/index.css`. Base UI (`@base-ui/react`) primitives in `src/ui/primitives/`: alert-dialog, badge, button, checkbox, context-menu, dialog, input, label, popover, sheet, switch, tooltip. `composite/` has kbd and param-pill. `cn` is in `src/ui/utils/cn.ts`; combobox classes in `src/ui/styles/combobox.ts`; the class-name test is `src/ui/styles/tailwind-class-names.test.ts`. |
| `@sapporta/grid` | `packages/grid` | Grid engine and column presets. CSS modules `src/core/react/grid.module.css` and `src/column-preset/sapporta-preset.module.css`. Column widths in `src/column-preset/column-sizing.ts` and `defaults.ts`. Numeric colour rules in `cells/NumericCell.tsx`. |
| `@sapporta/frontend` | `packages/frontend` | **Shell:** `src/shell/components/` (AppShell, Sidebar, SidebarShell, SidebarRegion, SidebarDrawer, SidebarToggle, Page, PageHeader, AccountMenu, AuthAccountMenu), `src/shell/navigation.ts`, `src/shell/state/theme-store.ts`. **Tables:** `src/table/` (page, filters, form, tgrid). **Reports:** `src/report/`. **Auth:** `src/auth/components/`. **Boot:** `src/app/boot/`. |
| `@sapporta/shared` | `packages/shared` | Contracts, including the `GridDataset` schema. |

**How tokens are wired in `packages/ui/src/index.css`**
- **`:root` colour variables:**
  - surfaces: `--sap-bg`, `--sap-surface`, `--sap-sidebar`, `--sap-nested-bg`, `--sap-chip-bg`, `--sap-row`, `--sap-row-hover`;
  - borders: `--sap-border` (`-strong`, `-soft`);
  - text: `--sap-fg` (`-soft`, `-muted`, `-subtle`);
  - brand: `--sap-brand` (`-soft`), `--sap-selection`, `--sap-focus-ring`;
  - links: `--sap-link`, `--sap-drill-down-link`, `--sap-loading-indicator-bar`;
  - numbers: `--sap-positive`, `--sap-warning`, `--sap-negative`;
  - nav: `--sap-active-nav-bg`, `--sap-nav-count-bg`;
  - kbd and project chip tokens, radii, z-indexes.
- **shadcn aliases** that point at the canonical tokens: `--background`, `--primary` (= ink),
  `--accent` (= `--sap-row-hover` since Step 2), `--ring` (= brown brand), `--border`
  (added in Step 2, with a layered base `border-color` rule), and so on.
- **Radii** are `--sap-radius`, `--sap-radius-sm`, `--sap-radius-lg`, `--sap-radius-xl`
  (since Step 2); the `--radius*` names are aliases.
- **`cn`** (`@sapporta/ui/cn`) knows the `sap-*` text, tracking and height scales; an app
  registers its own with `extendCn({ text, tracking, spacing })` (since Step 2).
- **Theme mode:** `useDocumentTheme()` reflects the store on `<html data-theme>`; `AppShell`
  calls it. `useThemeStore.getState().forceMode("light")` pins a mode (since Step 2).
- **`[data-theme="dark"]`** holds a warm dark palette.
- **`@theme inline`** turns these into utilities:
  - colours, radii;
  - `--text-sap-{tiny 9, micro 10, label 10.5, meta 11, menu 11.5, data 12, emph 12.5, body 13, mark 14.5, display 18}`;
  - `--tracking-sap-*`;
  - `--height-sap-{row 32, header 29, ctl 30, bar 24, topbar 52}`;
  - fonts (system UI).
- **`body`** is set to 13px, line-height 1.38. This rule is unlayered.

**Conventions**
- **`AGENTS.md`:** fix root causes, don't use `any`. User-facing text and docs are written
  from the app builder's point of view.
- **`packages/ui/AGENTS.md`:** loading and error states say what is happening; backend errors
  are shown word for word.
- **`COMMIT-CONVENTIONS.md`:** Linux-kernel style. Subject `subsystem: imperative lowercase`,
  75 columns or fewer. The body says what the problem was, then the solution, with no labels.
- **Changesets:** run `pnpm changeset` for every package you change.
- **Module index:** if you add a package export or subpath, update the module tables in
  `ARCHITECTURE.md` (`pnpm check:module-index` checks this).
- **Commands:** `pnpm dev` (runs `build:watch` for every package), `pnpm build`,
  `pnpm typecheck`, `pnpm test`.

### 2.3 How dbu6 uses Sapporta
- **Local links.** dbu6 depends on the local Sapporta checkout through `link:` dependencies
  (see `.package-source-switch.json`, mode `local`).
- **dbu6 reads Sapporta's built `dist/`, not its source.** dbu6's Vite config has no
  `sapporta:source` condition. To see framework changes, run `pnpm dev` in `sapporta/`
  (it rebuilds on change) alongside `pnpm dev` in dbu6. Otherwise you'll get stale code and types.
- **One copy of stateful packages.** Sapporta is linked from another checkout, so a package
  that both repos import resolves to two copies unless dbu6 points them at one.
  - `vite.config.ts` already does this for `react`, `react-dom`, `react-router-dom` and
    `zustand` (an alias to dbu6's `node_modules` plus `dedupe`).
  - Any package whose module state must be shared needs the same treatment if dbu6 imports it
    directly: `@base-ui/react` (popups nested inside Sapporta dialogs share its context) and
    `sonner` (the toast queue is module state).
  - Today dbu6's frontend can't resolve `@base-ui/react`, `sonner`, `class-variance-authority`
    or `clsx` at all. They are only Sapporta's dependencies.
- **Branches.** dbu6: `hdfc-bank-xls-parser`; don't commit to its `main`. Sapporta:
  `dbu6-redesign` was merged into `main` on 2026-09-15 and the checkout is on `main`; ask
  the owner before committing further Sapporta work.
- **Release.** When the Sapporta changes are stable: release Sapporta, then run
  `pnpm package-sources:use-npm` in dbu6.

---

## 3. Design source

The handoff bundle is at `/Users/jasim/Temporary/design_handoff_dbu6_redesign`. It may not
last forever. §4 condenses everything Steps 2–5 need from it.

| File | Contents |
|---|---|
| `README.md` | Full handoff: tokens, components, screens, interactions, state, definition of done |
| `tokens/globals.css` | The 2a token layer, written for a shadcn/Next.js app (see §6.2 before using it) |
| `tokens/fonts.ts` | Font setup (use the `<link>` fallback in its comment) |
| `components/*.tsx` | Reference components: `button-variants.ts`, `amount`, `category-label`, `transaction-row`, `status-chip`, `progress-steps`, `next-step-card`, `empty-state`, `app-sidebar` |
| `design/dbu6 Redesign Directions.dc.html` | All directions. **Turn 2, option 2a is the target.** Each option has a style-guide panel, then the screens Home, Import, Review, Report, Report-full and Advanced. |
| `design/SidebarNeutral.dc.html` | The 2a sidebar |

**Viewing the canvas.** The canvas loads `./support.js`, so serve the folder over HTTP rather
than opening the file directly:
`cd design && python3 -m http.server 8765`, then open
`http://127.0.0.1:8765/dbu6%20Redesign%20Directions.dc.html`.

The handoff's own framing:
- The designs are **high fidelity**. Colours, type, spacing, radii, shadows, copy and states
  are final. Only deviate where real data volume or an existing codebase pattern demands it.
- Screen order and section order within a screen are **not** fixed.
- What must hold: the token layer, the type scale, one primary action per screen, and the
  rules for money in and money out.

---

## 4. Design language spec (2a)

Condensed from the handoff. Values are exact unless marked otherwise.

### 4.1 Principles
- **Hierarchy comes from type and space**, not from boxes and colour. The screen stays quiet
  until something needs the user.
- **Colour rules:**
  - **Green is the only accent**: primary actions and money in.
  - **Blue is only for "something needs you"**: the review badge, the current step,
    "Choose a category".
  - **Red is only for real problems**: a balance mismatch, deleting something.
  - **Money out is plain ink.** Red is never a spending colour.
  - **Colour is never the only signal.** Always pair it with a sign, a label or a glyph.
- **No warm, cream or amber tint anywhere.**
- **Plain language.** Labels name destinations, not accounting verbs:
  - "Review", not "Draft entries";
  - "Add to my books", not "Post reviewed entries";
  - "Give them a category", not "Classify";
  - "All tools", not "Advanced".
  - Dates in everyday UI read "13 Sep", not `2026-09-13`.
  - Colon category paths appear only on the All tools screens, and in tooltips and aria labels.
- **The product should feel still.** Transitions are 120–160ms and change only colour or
  background. No layout or entrance animation.

### 4.2 Colour tokens

| Token | Hex | Use |
|---|---|---|
| `--background`, `--card`, `--popover` | `#FFFFFF` | page background, cards, rows, table bodies |
| `--secondary`, `--sidebar` | `#F6F7F7` | sidebar background, quiet fills |
| `--muted` | `#F8F9F9` | table headers, expanded rows, row hover, selected rows |
| `--border`, `--input` | `#E4E6E6` | card and section borders |
| `--line-inner` | `#EDEFEF` | row dividers inside a card |
| (outline border) | `#D2D5D5` | outline buttons, dashed dropzone and empty-state borders |
| `--foreground` | `#141616` | headings, row titles, money out |
| `--ink-soft` | `#4B4F4F` | body copy, descriptions (8.6:1) |
| `--muted-foreground` | `#5B5F5F` | column headers, small labels (7.0:1) |
| `--ink-meta` | `#5F6363` | raw bank descriptions, mono codes (6.4:1) |
| `--primary`, `--money-in`, `--ring` | `#2C6A4F` | primary buttons, money in, "up to date", focus ring |
| `--primary-foreground` | `#F7FBF8` | text on primary |
| (primary hover) | `#245A43` | |
| `--money-in-bg` / `-border` / `-ink` | `#EEF5F0` / `#BFD8C9` / `#1F4C38` | the "you saved" panel; `a:hover` uses `#1F4C38` |
| `--attention` / `-bg` / `-border` / `-ink` | `#2563A8` / `#EEF3FA` / `#A9C4E4` / `#1B4A80` | "needs you". `NeedsCategory` hover is `#E4EDF8`; the current-step card background is `#FBFDFF`. |
| `--waiting-bg` / `-border` / `-fg` | `#FAFBFB` / `#D9DBDB` / `#5F6363` | waiting states. Waiting markers use `#C4C7C7`; the waiting button is `#EEF0F0` background with `#4B4F4F` text. |
| `--destructive` | `#B4472C` (text on it `#FFFFFF`) | real problems only |
| `--shadow-card` | `0 1px 2px rgb(20 22 22 / .06)` | the only card shadow |
| `--shadow-pill` | `0 1px 2px rgb(20 22 22 / .07)` | active nav pill, primary button |

### 4.3 Category hues
There is one hue per **top-level** category, and child categories inherit it. The value in
brackets is the seeded dbu6 group name to alias (see §6.4).

| Hue key | Hex | Hue key | Hex |
|---|---|---|---|
| taxes | `#475569` | health | `#15803D` |
| home (`housing`) | `#2563A8` | utilities | `#0369A1` |
| food | `#C2410C` | personal | `#DB2777` |
| family | `#BE185D` | subscriptions | `#4F46E5` |
| children (`child`) | `#0E7490` | fees (`finance`) | `#78716C` |
| transport | `#7C3AED` | fun (`entertainment`) | `#E11D48` |
| insurance | `#0F766E` | giving | `#0891B2` |
| travel | `#B45309` | learning (`education`) | `#65A30D` |
| shopping | `#9333EA` | other (fallback) | `#C3C6C6` |

### 4.4 Type
- **Fonts:** Schibsted Grotesk (sans; 400/500/600/700) and IBM Plex Mono (400/500/600), both
  from Google Fonts.
- **Every figure** (money, counts, dates in rows, technical codes) is set in `font-mono` with
  tabular numbers (`.tnum`). Never set a figure in the sans face.

| Utility | Size / line-height / weight / tracking | Use |
|---|---|---|
| `text-display` | 40px / 1.08 / 600 / −0.02em | Home page title |
| `text-title` | 34px / 1.12 / 600 / −0.02em | screen titles |
| `text-heading` | 23px / 1.25 / 600 | next-step card, card headings |
| `text-subheading` | 19px / 1.3 / 600 | section headings inside cards |
| `text-body` | 17px / 1.5 / 400 | body and descriptions; also the `body` default |
| `text-row` | 16px / 1.35 / 600 in rows and buttons (nav items are 400 when inactive) | row titles, nav, buttons. **The smallest body size; never go lower.** |
| `text-meta` | 14px / 1.45 / 400 | meta, helper text, raw bank descriptions |
| `text-label` | 13px / 1.2 / 600 / 0.08em, uppercase | IN/OUT labels, column headers |
| mono figures | 15–20px / 400–600 | row amounts 18/500; large 20/500; display 33/600 |

### 4.5 Spacing, sizing, radii, shadow
- **Spacing scale:** 4 / 8 / 14 / 22 / 36 / 56px, which is Tailwind `1 / 2 / 3.5 / 5.5 / 9 / 14`.
- **Screen padding:** 36–56px. Home uses `px-14 py-10`; denser screens use `px-11 py-9`.
- **Cards:** padding 20–28px; gap between cards 14–22px.
- **Rows:** padding 13–14px vertical, 18–22px horizontal.
- **Click targets:** never below 44px. Primary buttons are 48px.
- **Radii:**
  - cards: 16px (`--radius-card`)
  - controls and pills: 11px (`--radius-control`)
  - step cards: 14px
  - dropzone: 18px
  - icon tiles: 9–10px
  - sidebar footer card: 12px
  - chips and badges: fully rounded
- **Shadow:** only `--shadow-card` (plus `--shadow-pill`). No large or coloured shadows.

### 4.6 Components
Reference code is in the handoff's `components/`. This table is the spec.

| Component | Anatomy and rules |
|---|---|
| **Button** | **Base:** `inline-flex gap-2`, radius 11px, 16px/600, focus-visible ring 3px at `ring/40`, SVG icons 18px. **Variants:** *default* (primary): green background, `shadow-pill`, hover `#245A43`; *outline* (secondary, e.g. "Choose files", "Download"): white background, 1px `#D2D5D5` border, hover muted; *ghost* (tertiary, e.g. "See the report", "Add an account"): green text, `px-1`, hover underline; *destructive* (rare). **Sizes:** default 48px tall with 22px side padding; sm 40px, 16px padding, 14px text; lg 52px, 28px padding. **Waiting** (disabled until something is done): `#EEF0F0` background, `#4B4F4F` text, `cursor-not-allowed`, **never opacity-50**, and always a reason underneath (e.g. "12 still need a category"). One primary button per screen. |
| **Amount** | Always an explicit sign (`+` or `−`, U+2212), optional `₹`, `en-IN` grouping with 2 decimals, mono and tabular. Colour: money in is green, money out is ink. An IN/OUT `text-label` in `ink-meta` sits under the figure. Right-aligned. Sizes: row 18/500, lg 20/500, display 33/600 at −0.02em. |
| **CategoryLabel** | A pill: fully rounded, 1px border, background `#F5F6F6`, padding 5px vertical / 10px left / 13px right, 15px text. A 9px dot in the top-level group's hue, then the friendly name. The colon path goes only in `title` and aria attributes. |
| **NeedsCategory** | A button pill: dashed `attention-border`, `attention-bg` background, padding 14px × 6px, 15px/600 in `attention-ink`, hover `#E4EDF8`, label "Choose a category". Clicking it opens the category picker (§4.7). |
| **TransactionRow** | Grid columns `30px 96px minmax(0,1fr) 250px 176px`, gap 18px, top border `line-inner`, padding 22px × 13px. Columns: checkbox, date (mono 15px `ink-meta`, "13 Sep"), name (16.5px/600) over the raw description (mono 14px `ink-meta`, truncated, never wrapped), CategoryLabel or NeedsCategory, Amount. Selected rows are `bg-muted`. The row must not reflow. Virtualise the list beyond about 100 rows, not the row. |
| **StatusChip** | 14px/600 text with an 8px dot. Tones: ok (green), attention (`attention-ink`, blue dot), waiting (`ink-meta`, `#C4C7C7` dot), problem (destructive). Glyph plus colour. |
| **ProgressSteps** | An `<ol>`, `grid-cols-4 gap-3.5`, cards with 14px radius and padding 18px × 16px. Title 15.5px/600; detail 14px `ink-meta`, 9px above. **Done:** border, white card, 20px green ✓ marker. **Current:** 1.5px `attention-border`, background `#FBFDFF`, blue numeral marker (mono 11px, white on `--attention`), detail in `attention-ink` at weight 500, `aria-current="step"`. **Waiting:** dashed `#D9DBDB` border, background `#FAFBFB`, dashed `#C4C7C7` marker, muted title. Never more than one current step. |
| **NextStepCard** | A card: 16px radius, border, padding 28px × 26px, `shadow-card`, gap 26px. A 52px round medallion (attention background, border and ink; mono 19px/600) holds the count, then a `text-heading` title, a `text-body ink-soft` body (max 640px), and a primary Button. Exactly one per screen, at the top of Home. |
| **EmptyState** | 16px radius, dashed `#D2D5D5` border, white background, padding 24px × 40px, centred. A `text-subheading` title, a `text-body ink-soft` body (max 420px), and an optional outline Button. No illustration, no exclamation mark. Used for: nothing to review, no statements yet, a report with no data for the chosen dates, no search results. |
| **Sidebar** | **Container:** 248px wide, `--sidebar` background, right border. **Header:** padding 22px top, 20px sides, 18px bottom. A 34px tile with 10px radius (green, "d" 17px/700), then "dbu6" (16px/600, −0.01em) and the household name (13px `ink-meta`). **Items:** gap 3px, group padding 12px × 6px, each item 11px radius, padding 13px × 11px, 16px. Inactive items are `ink-soft`, weight 400, no fill. The active item is a white pill with `shadow-pill`, weight 600, `foreground` colour. **Badge:** mono 13px/500, white on `--attention`, padding 8px × 2px, fully rounded; hidden at zero. **Separator:** margin 20px sides × 14px. **Second group:** 15px text, 10px vertical padding. **Footer card:** margin 14px, 12px radius, border, white, padding 12px. A 32px circle avatar (`#D5D8D8`, initials 13px/600) next to the name (14px/600) and "Settings" (12.5px `ink-meta`). **Items:** Home · Accounts · Import statements · Review (badge = drafts needing a category) · Reports, then a rule, then All tools · Help & support. Lucide icons are allowed at 18px, monochrome `currentColor`. |
| **Mapping to primitives** | Review tabs → Tabs. Report drill-down → Collapsible per group row. Date range → ToggleGroup for presets plus Calendar in a Popover for "Pick dates". Category picker → Command in a Popover. Bulk action bar → a fixed card on `--foreground` with white text. Status → Badge. |

### 4.7 Interactions and behaviour
- **Hover:** rows use `bg-muted`; primary buttons darken to `#245A43`; outline buttons go
  muted; ghost buttons and links underline. **Focus-visible:** 3px ring in `--ring` at 40%.
- **Categorising:** `NeedsCategory` opens a command palette in a popover:
  - recent and suggested categories;
  - keyboard-first; Enter applies;
  - an "apply to all similar" option, keyed on the raw description prefix.
- **Bulk actions:** selecting rows raises a dark bar reading "3 selected | Give them all a
  category | Mark as duplicates | Clear selection". "Give them all a category" opens the same
  picker for the whole selection.
- **Gating the primary action:** "Add N to my books" uses the waiting style until the queue is
  clear, with the reason shown underneath.
- **Drill-down:** each group row collapses on its own; "Collapse all" resets them.
- **Report date ranges:**
  - Changing a preset refetches immediately. There is no "Run report" button.
  - "Pick dates" opens a calendar popover and shows the chosen range as text.
  - Never show bare `dd/mm/yyyy` inputs.
- **Empty and loading states:**
  - `EmptyState` when there is no data.
  - Skeleton rows that match the real row height (52px).
  - Summary tiles keep their shape while loading.
- **Errors:** a balance mismatch is the one state that uses the destructive colour. It shows
  the expected and computed figures and the difference, and it blocks posting.
- **Assets:** none. No illustrations and no icon set. Markers are dots, tiles carry 1–2 letters
  or digits, and the only glyphs are ✓ ! → › ▸ ▾ ↑.

### 4.8 Screens in the handoff (a starting point for Step 6 discussions)
Screens are designed at 1440px wide: a 248px sidebar plus the main area. There is **no top
bar**; each title sits at the top of the content.

- **Home (`/`).** Purpose: tell the user where they are and give them one thing to do.
  - **Order:** date eyebrow ("Saturday, 13 September 2026") → greeting in `text-display`
    ("You're nearly up to date") → `NextStepCard` → `ProgressSteps` → two columns
    (`grid-cols-[1.35fr_1fr] gap-5`): "Your accounts" card on the left, "September so far"
    card on the right.
  - **NextStepCard:** count 12, "12 transactions need a category", "They came in with this
    morning's HDFC Savings statement. Nothing is added to your books until you've checked
    them.", button "Review transactions".
  - **ProgressSteps:**
    - "Accounts added / 4 accounts set up" (done)
    - "Statement imported / HDFC Savings, up to 13 Sep" (done)
    - "Review the new ones / You're here — 12 left to check" (current)
    - "Add to my books / Waiting on the review" (waiting)
  - **Accounts card:** ghost "Add an account" in the header. Each row has:
    - name, 16.5px/600;
    - a subline, 14px `ink-meta` ("Bank account · checked to 13 Sep" or "Nothing imported since 31 Aug");
    - balance, mono 17px;
    - a StatusChip ("Up to date") or an "Import statement" link.
  - **Month card:**
    - "Money in +4,45,785", with a full-width green bar;
    - "Money out −3,50,560", with an ink bar at 79% width;
    - a rule, then "You kept ₹95,225" in mono 32px and "21% of what came in this month";
    - a "Full report" link.
  - **Replaces:** the wall of instructions and its five identical brown buttons.
- **Import statements (`/import`).**
  - **Header:** title, plus "Drop in the files you downloaded from your bank. We work out
    which account each one belongs to, so you can add several banks at once."
  - **Dropzone:** 2px dashed `#D2D5D5`, background `#FCFCFC`, 18px radius, 38px padding,
    centred. It holds a 44px tile, "Drop your statement files here", "PDF, Excel, CSV or
    text — add as many as you like", and an outline "Choose files" button.
  - **File list:** "3 files ready" with a ghost "Clear all", then one card listing the files.
    Each row has:
    - a 38px type tile (PDF/XLS/CSV);
    - the filename, with "1–13 Sep · 21 transactions found" under it;
    - a pill showing the matched account;
    - a ghost "Change" button.

    The last row in the same card is "+ Add names from Google Pay (optional)" with "Open".
  - **Footer card:** "47 transactions across 3 accounts" / "They'll wait in your review list.
    Your books don't change until you add them." and a primary "Import and review".
  - **Rules:**
    - Never show the native file input.
    - Google Pay Takeout is revealed inside the card, not a second form.
    - The primary action is enabled only when at least one file is matched.
- **Review (`/review`, was "Draft entries").**
  - **Header:** "Review 21 transactions" + "HDFC Savings · 1–13 September 2026 · imported
    today". On the right, a primary "Add 21 to my books" with "12 still need a category" under it.
  - **Balance strip** (a card, padding 16px × 22px):
    - a green ✓ medallion and "The balances match";
    - "Statement closing balance ₹3,26,445.00";
    - "Your books after this import ₹3,26,445.00";
    - "Possible duplicates: 2 found — take a look".
  - **Tabs as pills:** "Needs a category · 12" (active, ink fill), "Possible duplicates · 2",
    "Already checked · 7", "All · 21". A 230px search box on the right.
  - **Table card:**
    - a muted header row (`grid-cols-[30px_96px_1fr_250px_176px]`, 13px uppercase);
    - `TransactionRow`s;
    - a footer: "Showing 10 of 21 / Show the rest".
  - **Bulk bar** along the bottom.
- **Income & expenses (`/reports/income-expenses`), first view.**
  - **Header:** "Where your money went" + "1 April – 13 September 2026 · all four accounts".
    On the right, preset pills: This month / Last 3 months / This year (active) / Pick dates.
  - **Three tiles** (`grid-cols-3 gap-4`):
    - Money in +₹37,55,785 (green, "Mostly salary · 4 sources");
    - Money out −₹24,81,560 (ink, "Across 17 groups of spending");
    - **You saved** ₹12,74,225, on `money-in-bg` with a `money-in-border`, and "34 paise of
      every rupee you earned".
  - **"Month by month" card:** 6 month pairs of bars (in is green, out is ink), 34px wide,
    7px gap, 132px tall, plus a legend.
  - **Two columns** (`grid-cols-[1.5fr_1fr]`):
    - **"Biggest spends":** the top 5 groups, each with hue dot, name, mono amount, share %
      and a bar underneath, plus an "All 17 groups" link;
    - **"Where it came from":** 4 income groups with green mono amounts.
- **Income & expenses, full detail.**
  - **Compact header:** "Every category", date range, "Collapse all", "Download".
  - **Two columns** (`grid-cols-2`):
    - **"Money out −₹24,81,560":** 17 collapsible group rows (chevron, hue dot, name, share %,
      mono amount). Expanded groups show their children on `#F8F9F9`, indented 40px.
    - **"Money in"**, built the same way.
  - **Below:** a "What you kept" panel and a small "Same numbers, accountant's view" card
    (Revenue / Expenses / Net income, plus a link to the income statement).
  - Grouping is by the first path segment. Children appear only when a group is expanded.
- **All tools (`/tools`, was "Advanced").**
  - **Header:** "All tools" + "Everything dbu6 can do, including the bookkeeping views behind
    the everyday screens. You don't need anything here for a normal import."
  - **Search and note:** a search field, plus a note chip "Changes made here go straight into
    your books".
  - **Two columns:**
    - **"The raw tables":** Accounts, Draft transactions, Journal entries, Journals. Each
      has a plain-English line, with its technical table name in mono on the right.
    - **"Step-by-step tools":** numbered tiles for Import statements, Run the categoriser
      again, Preview as ledger text, Post drafts to the books.
  - **"Every report":** 12 cards in 3 columns, each with a name and a one-line description.
    Six everyday reports get a green marker and six accounting reports a grey one.
  - **Rule:** nothing is removed from the product. The old sidebar's links live here,
    renamed, with their technical names still visible.
- **State each screen implies:**
  - **accounts:** id, name, kind, balance, lastImportedTo, status.
  - **import session:** files (name, kind, matched account, date range, transaction count),
    Google Pay file, totals.
  - **review:**
    - drafts, tab filter, selection, search, balance check, duplicate count;
    - mutations `setCategory(ids, categoryId)`, `markDuplicate(ids)`, `post(ids)`.
  - **report:** range preset and resolved dates, grouped totals, monthly series, expanded groups.
  - **counts:** the needs-a-category count, fetched once at layout level. It drives the sidebar
    badge and the Home next-step card.

### 4.9 Definition of done (from the handoff)
- 16px body floor everywhere.
- All text has at least 4.5:1 contrast.
- Every figure is mono and tabular.
- Money in and out is never shown by colour alone.
- One primary action per screen.
- No colon category paths outside All tools.
- A 400-row review list stays readable and doesn't reflow.
- No warm, cream or amber tint.

### 4.10 Inconsistencies inside the handoff (resolve as noted)
- **Button heights.** "Click targets never below 44px" vs. the `sm` button at 40px.
  → Proposed: `sm` is 44px. Confirm in D5.
- **`text-row` weight.** The README says 16/600, but the token has no weight, and inactive nav
  items are 400. → The weight belongs to the component, not the token.
- **Sidebar meta colour.** The sidebar mock uses `#616565`, the token is `#5F6363`. → Use the token.
- **Doubled sign.** The report mock shows "++₹36,42,375". → A mock bug; show one sign.
- **`--accent`.** `tokens/globals.css` sets `--accent` to the attention blue. In Sapporta,
  `--accent` is the neutral hover colour. → Keep `--accent` neutral (§6.2).
- **Hue keys vs. seeded group names.** `home`, `children`, `fun`, `learning` and `fees` don't
  match `housing`, `child`, `entertainment`, `education` and `finance`. → Alias them (§4.3).

---

## 5. Decisions

**Status:** all decided. D1, D4 and the Button part of D5 were decided with the project owner
on 2026-09-15; the owner adopted D2, D3, D5's generic primitives, D6 and D7 as proposed on
the same day, when implementation started. Steps list the decisions they depend on.

**D1. Where the theme lives, and what goes into Sapporta. Decided (2026-09-15).**
- **Values.** dbu6 owns all the values (palette, fonts, scale, category hues) in `app.css`.
  Sapporta gets none of them.
- **The depth rule** decides what changes in Sapporta:
  - **A token or prop earns its place** when one name controls many sites, or when it hides
    behaviour.
  - **If a proposed hook maps one-for-one onto the class strings of a single component,**
    Sapporta would become a module whose interface is as big as its implementation. Inline
    that component into dbu6 instead.
  - So Sapporta gets bug fixes (§6.4), tokens that reach many sites, and gaps in its
    behaviour primitives. Its presentational components are not made customisable.
- **DOM-selector overrides in dbu6** are a stopgap only.
- **Rejected alternatives:**
  - *Override only*: fragile, and leaves the `cn()` and dark-mode bugs.
  - *Extend Sapporta's presentational components with slots and tokens until they match 2a*:
    about 25 new props and tokens for the sidebar alone (§6.8).

**D2. How far the comfortable density reaches. Decided (2026-09-15): (a).**
- **(a)** One comfortable scale everywhere, including Sapporta grids and raw tables. Works
  today through a trailing `@theme inline`, and matches the handoff's 16px floor.
- **(b)** Comfortable on dbu6 pages and dense in Sapporta tables. Needs Sapporta sizes as
  runtime variables plus a density scope.
- **(a) it is.** Look again only if the raw tables feel unusable. Risk: the JS column-width
  caps (numbers 112px, timestamps 160px) may truncate at 15–16px mono. Step 4 checks this.

**D3. Dark mode. Decided (2026-09-15).**
- 2a is light only.
- Force light now. The theme store no longer applies itself on import (`useDocumentTheme`
  does, from `AppShell`), and `forceMode("light")` pins the mode; dbu6 calls it in
  `main.tsx`. A dark 2a can come later if wanted.

**D4. App shell and sidebar. Decided (2026-09-15).**
- **dbu6 owns the shell's composition and markup.** It stops rendering Sapporta's `AppShell`
  and builds its own from Sapporta's exported **behaviour** primitives:
  - `SidebarProvider`/`useSidebar`: the remembered collapse state, drawer state, screen-size query;
  - `SidebarRegion`: desktop collapse, hover-to-reveal, the modal drawer on compact screens;
  - `SidebarToggle`;
  - `isNavigationItemActive`, `navigationItems` and the `Navigation` types (dbu6 may extend
    the item type locally, e.g. with `badge`);
  - `AuthAccountMenu` with `renderTrigger`;
  - `PageFrame`, `PageBody`, `usePageTitle`;
  - `useAuthStore` and `useSchemaStore`.
- **Inlined into dbu6** (the presentation layer, rewritten to 2a rather than copied):
  - `AppShell`'s layout;
  - the sidebar: header, sections, nav item, badge, footer card;
  - the icon rail and mobile bottom bar;
  - page titles on dbu6's own pages.
- **No new props, slots or nav tokens in Sapporta.** Sapporta's `AppShell` and `PageHeader`
  stay as they are for other apps. Sapporta's own screens (tables, report frame, profile)
  keep using `PageHeader`, themed by tokens only.
- **Sapporta changes only where the behaviour primitives leak** (§6.8, tasks in §8):
  1. `SidebarRegion`/`SidebarDrawer` hardcode `w-[240px]`;
  2. apps with their own shell need the Toaster instance Sapporta's `toast()` calls use;
  3. `PageHeader.css` depends on a DOM contract the shell must satisfy.
- **Why.** Matching the 2a sidebar through Sapporta would need about 25 props and tokens on
  roughly 120 lines of markup, and page headers differ on every 2a screen (§6.8). Inlining
  also lets dbu6 drop behaviour it doesn't need once P0 cuts the navigation to 7 items.
- **Cost, accepted:**
  - dbu6 maintains roughly 300 lines of shell;
  - it re-tests the composition-level behaviour Sapporta's `SidebarArchitecture.test.ts` covered;
  - it keeps leaks 2 and 3 honoured.
- **Icons:** keep Lucide icons at 18px, monochrome; the rail and bottom bar need them.
- **Width:** 248px, a dbu6 value.

**D5. Buttons and primitives.**
- **Buttons. Decided (2026-09-15).**
  - Sapporta's `Button` is a 34-line cva over Base UI's button, a shallow module.
  - **dbu6 owns a `Button`**, built from the handoff's `button-variants.ts`: the 2a sizes
    (48 default, 44 sm, 52 lg), the variants (primary, outline, ghost-as-link, destructive)
    and the waiting style.
  - **Sapporta's `Button` gets token fixes only** (heights, radius and type from the existing
    tiers), so Sapporta's own screens still match. It gets no 2a variants.
- **Generic primitives. Decided (2026-09-15)** (the depth rule applied):
  - Tabs, Collapsible, ToggleGroup, Select, RadioGroup, Card, Separator and Command are thin
    wrappers over Base UI, and no Sapporta screen uses them.
  - They go in `dbu6/packages/frontend/src/components/ui/`, on `@base-ui/react` resolved to
    a single copy (§2.3).
  - Each is added when a Step 6 page needs it. Move one to `@sapporta/ui` only when Sapporta's
    own screens need it.
- **Reused Sapporta primitives.** dbu6 keeps using Sapporta's Checkbox, Popover, Dialog,
  Sheet, Tooltip and Input (themed by tokens, sized in Step 4). They are what Sapporta's
  screens and the grid use too.
- **Domain components** (Amount, CategoryLabel, NeedsCategory, TransactionRow, StatusChip,
  ProgressSteps, NextStepCard, EmptyState) go in `dbu6/packages/frontend/src/components/`.
- **Calendar** is not in Base UI. Decide in Step 6, page P4.

**D6. Colour meanings that 2a changes. Decided (2026-09-15).**
- **Money out vs. errors.** Sapporta's `--sap-negative` painted both negative figures
  (`NumericCell` `colorRule: "negative"`) and error states. Step 2 added
  `--sap-numeric-negative` (defaults to `--sap-negative`; ink in dbu6), used by `NumericCell`
  and `ReportSummaryStats`' negative tone. `--sap-negative` stays the danger token
  (`#B4472C` in dbu6).
- **Warnings.**
  - `--sap-warning` is amber, which 2a doesn't have.
  - It is used once in Sapporta, a notice in `auth/components/AuthPages.tsx`.
  - dbu6 sets it to the attention ink (`#1B4A80`). Real problems use destructive.
- **Attention tone.** A dbu6 token (`--attention-*`, §4.2), used by dbu6 components. Sapporta
  gets no attention token or Badge variant, since no Sapporta screen needs one (D1).
- **Links, drill-down links and the loading bar** change from blue to green.

**D7. Shadows for floating layers. Decided (2026-09-15).**
- 2a allows one card shadow, but popovers, menus and dialogs need elevation.
- One extra elevation token, used only for floating layers. Step 4 adds it.

---

## 6. Step 1: Audit findings (done 2026-09-14)

**How the audit was done.**
- Read all of dbu6's frontend.
- Read Sapporta's `ui`, `grid` and `frontend` packages (tokens, shell, primitives, grid CSS,
  table, report and auth screens).
- Compiled dbu6's real `app.css` with its Tailwind version in memory to check the cascade.
- Ran `tailwind-merge` on real class strings.

### 6.1 What the handoff assumes vs. what dbu6 is

| Handoff assumes | dbu6 actually has | Consequence |
|---|---|---|
| Next.js, `next/font`, `next/link`, `usePathname` | Vite and React Router | Load fonts with a `<link>` in `packages/frontend/index.html`. Use `Link` and `useLocation`. |
| shadcn/ui `components/ui/*`, `cn` from `@/lib/utils` | `@sapporta/ui` primitives (§2.2) and `cn` from `@sapporta/ui/cn`. There is no `@/` path alias. | Missing: tabs, collapsible, toggle-group, select, radio-group, card, separator, command, calendar, empty (D5). |
| The app composes shadcn `ui/sidebar` itself | Sapporta `AppShell` renders the sidebar from a `Navigation` array | dbu6 composes its own shell from Sapporta's sidebar behaviour primitives (D4, §6.8, §8). |
| `globals.css` owns `:root` and `@theme` | Sapporta's token file sits in the middle of `app.css` | Theme through `--sap-*` plus dbu6 extra tokens. Don't paste globals.css (§6.2). |
| Dark mode through a `.dark` class | `[data-theme="dark"]`, set automatically from the OS when `@sapporta/frontend/shell` is imported | Users whose OS is dark get Sapporta's warm dark palette today (D3). |
| Custom `text-*` sizes merge safely | Sapporta's `cn()` is plain `twMerge` | Custom sizes get dropped (§6.4). Fix first. |

### 6.2 Why `tokens/globals.css` can't be pasted as it is
1. **`--accent: #EEF3FA` (blue).** Sapporta uses `bg-accent` as the neutral hover on ghost and
   outline buttons, context-menu items and combobox options. Copying this value turns every
   hover blue. Keep `--accent` neutral and use `--attention-*` for the blue.
2. **`body { font-size: 17px }` is in `@layer base`.** Sapporta's `body { font-size: 13px }` is
   unlayered, so it wins. Our body rule must be unlayered too.
3. **`a { @apply text-primary }` colours every link.** That includes the sidebar's nav anchors
   and grid links. Scope it to links in page content.
4. **Sizes, heights, tracking and fonts in `@theme inline` are fixed when the CSS is built.**
   Sapporta's are declared this way, so `:root { --text-sap-body: … }` does nothing.
   - Redeclare them in a **trailing `@theme inline` block in `app.css`** (confirmed to work,
     globally).
   - Colours and radii are live CSS variables, so `:root` overrides work for those.
5. **Leftovers from the shadcn setup:**
   - `@import "tailwindcss"` is already in `app.css`.
   - `tw-animate-css` isn't installed.
   - `@custom-variant dark (&:is(.dark *))` doesn't match `[data-theme]`.
6. **Custom size names collide with tailwind-merge.** `text-display`, `text-title`,
   `text-heading`, `text-subheading`, `text-body`, `text-row`, `text-meta` and `text-label`
   would be read as colours. They must be registered with tailwind-merge (same fix as §6.4).

### 6.3 What can be themed from `dbu6/packages/frontend/src/app.css`

**Summary**
- **Colour, fonts and the base type and height scale:** all of it, from `app.css`, today.
- **The shape of shared components** (table and report chrome, dialogs, button sizes): needs
  Sapporta changes, mostly turning fixed values into the existing tiers.
- **The sidebar and page header** would need many new extension points. §6.8 shows why they
  are inlined into dbu6 instead (D4). The table below records what blocks them as they are.
- **The grid** is the most themeable Sapporta surface.

| Surface | From `app.css` today | What blocks it | Step |
|---|---|---|---|
| **Colours, everywhere** | Yes. `--sap-*` and the aliases are live variables. | `--accent` is tied to active-nav. Money out and errors share `--sap-negative`. There's no `--border` token, so dialogs and popovers draw ink borders. Three tokens are used but never defined. | 2 |
| **Fonts** | Yes. Trailing `@theme inline { --font-sans; --font-mono }` plus a `<link>`. | — | 2 |
| **Type sizes** | Yes, globally. Trailing `@theme inline` for `--text-sap-*`, plus an unlayered `body` rule. | `cn()` drops sizes. About 13 fixed `text-[Npx]` plus Tailwind `text-sm`/`text-xs` in framework screens. | 2, 4 |
| **Row, header and control heights** | Yes, globally, through trailing `@theme inline` for `--height-sap-*`. | About 40 fixed `h-9`/`h-10`/`h-11`/`rounded-[5px]`/`rounded-[6px]` in table and report chrome. Button tops out at 40px. | 4 |
| **Radii** | Partly. `--radius*` are live. | Many fixed values. `@theme inline { --radius-lg: var(--radius-lg) }` refers to itself. | 2, 4 |
| **Sidebar colours** | Yes | — | 2 |
| **Sidebar shape** | Only through fragile DOM selectors | No brand slot: a gradient mark and the word "Sapporta" are hardcoded in `Sidebar.tsx` `SidebarHeader`. No nav badges; `NavigationItem` is `{label, to, icon?}`. Section labels are required. Width is `w-[240px]` in 4 places. The active state is only a background. | 3 |
| **Sidebar footer** | Yes: `sidebarFooter` + `AuthAccountMenu renderTrigger` | — | 3 |
| **Page header** | Colours; `headerClassName` | A fixed 52px bar. Title `text-[15px] font-[720]` is smaller than the 17px body. No description slot. | 3, 6 |
| **Grid (tables and reports)** | Mostly: colours, row/header height and type through tokens; `--grid-*` variables on `.sapporta-table-grid`; stable `data-grid-part` and `data-row-*` attributes | CSS-module class names are hashed, so don't target them. Fixed: chevron 28px, cell actions 24px, header menu 16px, card radius 6px, card label 12px and title 15px, nested indents. Default column widths are px values in JS. Link and loading tokens are blue. No virtualisation. | 4 |
| **UI primitives** | Colours and radii | Fixed `h-9`/`text-sm`; no 48px button and variants can't be extended; no attention badge; the Dialog close button can't be hidden. | 4 |
| **Auth, profile, workspace settings, boot loader** | Colours | Many fixed values, `text-red-600`, `bg-sap-brand text-white`, unstyled links. | 4 |
| **Dark mode** | No | The theme store applies dark from the OS at import; no forced mode. | 2 |

**Grid override notes** (for Step 4, if not tokenised in Sapporta)
- `--grid-*` variables are declared on the grid root itself. Set them on `.sapporta-table-grid`,
  not `:root`.
- Nested levels redeclare row height and row-header width at specificity (0,3,0):
  `.sapporta-table-grid[data-grid-depth]:not([data-grid-depth="0"])`.

### 6.4 Bugs found

**Sapporta**
- **`cn()` drops sizes** (`packages/ui/src/ui/utils/cn.ts`). tailwind-merge reads
  `text-sap-*` as a text colour. Confirmed losses:
  - `PageHeaderButton`, Sidebar `NavItem`, `ReportChrome`, `TableHeaderControls`, `Kbd`.
  - The 18px value in `ReportSummaryStats` falls back to body size.
  - `<Button className="text-sap-body">` loses its foreground colour.
  - `h-9` alongside `h-sap-ctl` isn't merged; CSS order decides which wins.
- **No `--border` / `--color-border`.** Tailwind preflight makes borders `currentColor`, so
  Dialog, AlertDialog, Popover, Tooltip, ContextMenu, Sheet and combobox draw ink borders.
  `bg-border` (the ContextMenu separator) generates nothing.
- **Tokens used but never defined:**
  - `--sap-surface-muted` (`table/tgrid/table-card.css`, `table/page/RecordDetailSheet.tsx`)
  - `--sap-muted` (`table-card.css`, so card labels use a fixed `hsl(215 14% 45%)`)
  - `--sap-subtle` (`table/tgrid/tgrid-cell-links.css`)
- **Dead CSS:** `:where(.sapporta-table-grid--editable)` in `table-card.css` loses to
  `.presetGrid`, so the editable focus ring never shows.
- **Dark mode applies itself:** `shell/state/theme-store.ts` sets `data-theme` when the module loads.
- **`--accent` is tied to `--sap-active-nav-bg`**, so styling the active nav item also changes every hover.
- **The inverted Kbd ignores its token:** it uses `bg-white/15` instead of `--sap-kbd-inverted-bg`.
- **Numeric colour rules share the error colour:** `NumericCell.tsx` paints `colorRule: "negative"`
  with `text-sap-negative`, the same token as error states (D6).

**dbu6**
- **Class names that don't exist render nothing:**
  - `bg-sap-panel`: `Welcome.tsx` ×2, `Advanced.tsx`
  - `bg-nested`: 11 places in `views/import-statements/cards.tsx`, `views/AutoImportStatements.tsx`,
    `views/ReclassifyDrafts.tsx`, `views/RenderDraftHledger.tsx`, `views/ImportFreeformTransactions.tsx`
- **Tailwind's default palette** (`green-*`, `amber-*`, including warm dark variants) in import
  cards, `PostDrafts.tsx` and `ReclassifyDrafts.tsx`.
- **Small type:** 54 × `text-sm` and 28 × `text-xs`, below the 16px floor.
- **Native, unstyled controls:**
  - `<input type="file">` (the handoff says never use it);
  - `<select>` and radios (`ImportFreeformTransactions.tsx`);
  - a raw `<table>` (`ReclassifyDrafts.tsx`);
  - hand-rolled buttons with `disabled:opacity-50`.
- **`views/JournalsTable.tsx` places "Render as hledger" at absolute `right-[190px] top-[11px]`.**
  It will misalign once the header changes size.
- **Withdrawals are painted red:** `colorRule: "negative"` on `withdrawal` in
  `packages/api/schema/draft-journals.ts`. 2a says money out is ink.

### 6.5 Screen inventory

| Route (today) | Component | Built by | Handoff screen | Steps |
|---|---|---|---|---|
| `/welcome` (`/` redirects here) | `src/Welcome.tsx` | dbu6 | Home | 2–5, P1 |
| `/tables/accounts`, `/setup/accounts/new` | `TableRoute`, `NewRecordRoute` | Sapporta | — (Home's accounts card is closest) | 2–4, P6 |
| `/reports/last-reconciled` ("Import checkpoint") | `src/reports/LastReconciledReport.tsx` | dbu6 on Sapporta report frame | — (becomes account status on Home) | 2–4, P1 |
| `/views/import-statements` | `src/views/AutoImportStatements.tsx`, `import-statements/cards.tsx` | dbu6 | Import | 2–5, P2 |
| `/views/import-freeform-transactions` | `src/views/ImportFreeformTransactions.tsx` | dbu6 | — | 2–5, P2 |
| `/tables/draft_transactions` ("Draft entries") | `src/views/draft-transactions/DraftTransactionsTable.tsx` (Sapporta grid) | dbu6 on Sapporta | Review | 2–5, P3 |
| `/views/reclassify-drafts` | `src/views/ReclassifyDrafts.tsx` | dbu6 | Review; All tools step 2 | 2–5, P3 |
| `/reports/duplicate-drafts` | report | dbu6 on Sapporta | Review "Possible duplicates" tab | 2–4, P3 |
| `/reports/draft-balance-assertions` | report | dbu6 on Sapporta | Review balance strip | 2–4, P3 |
| `/views/post-drafts` | `src/views/PostDrafts.tsx` | dbu6 | Review primary action | 2–5, P3 |
| `/reports/income-statement` | report | dbu6 on Sapporta | Income & expenses (both views) | 2–4, P4 |
| `/advanced` | `src/Advanced.tsx` | dbu6 | All tools | 2–5, P5 |
| `/reports/{account-ledger, balance-sheet, monthly-summary, net-worth, expense-breakdown, asset-inflows, trial-balance, balance-assertions}` | `src/reports/*` | dbu6 on Sapporta | — (named in All tools) | 2–4, P7 |
| `/views/render-draft-hledger`, `/tables/journals`, `/tables/:name` | `RenderDraftHledger.tsx`, `JournalsTable.tsx`, `TableRoute` | dbu6 / Sapporta | All tools | 2–5, P8 |
| `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password`, `/account/profile`, `/workspace/settings`, not found, boot loader | auth, profile, app | Sapporta | — | 2–4, P9 |

### 6.6 Data the design implies that the app doesn't have yet (for Step 6)
- **Clean merchant names** ("Zomato" next to the raw `UPI/ZOMATO/…`). Drafts only have `narration`.
- **Friendly category names and hues.** Derive from the path
  (`expenses:food:food-delivery` → "Food delivery", hue from `food`), or store them on `accounts`.
- **A preview before import** (matched account, date range, count, "Change"). Today one
  `POST /import-draft/statements/auto` plans and imports together.
  `packages/api/bank-importer/auto-import-plan.ts` already exists on the server.
- **Mark as duplicate.** There's a duplicate-drafts report but no mutation.
- **An "import" as a unit** ("HDFC Savings · 1–13 Sep · imported today"). Drafts are keyed by
  `base_account_id`; posting runs per account.
- **Account status on Home** ("Up to date", "checked to 13 Sep"). Likely derivable from
  last-reconciled and balance assertions.
- **Report shapes.** Reports return a `GridDataset`. Tiles, bars and grouped collapsible lists
  need that data read differently, or JSON endpoints.
- **Sidebar badge count** (drafts needing a category): the table API's `meta.total`, as
  `PostDrafts.tsx` already does.
- **Household and user name in the sidebar**, from workspace and auth.
- **Help & support** doesn't exist.

### 6.7 Baseline screenshots (before any change)

**Folder:** `/private/tmp/claude-501/-Users-jasim-m-a-code-dbu6/7499e42b-f584-45a1-bb7c-2f5c1a034b42/scratchpad/dbu6-screenshots`

- Taken 2026-09-13 by the project owner, 1920px wide.
- They cover the five screens the handoff redesigns.
- The folder is under `/private/tmp`, so it may be cleared on reboot. If it's gone, ask the
  owner rather than re-creating it from the current code, since that code may already be
  themed.

| File | Size | Route | Handoff screen | Page |
|---|---|---|---|---|
| `01-welcome.png` | 1920×1222 | `/welcome` | Home | P1 |
| `02-import-statements.png` | 1920×1080 | `/views/import-statements` | Import | P2 |
| `03-draft-transactions.png` | 1920×1080 | `/tables/draft_transactions` | Review | P3 |
| `04a-income-statement-first-screen.png` | 1920×1080 (first screen) | `/reports/income-statement` | Income & expenses | P4 |
| `04b-income-statement-full.png` | 1920×2263 (full page) | `/reports/income-statement` | Income & expenses, full detail | P4 |
| `05-advanced.png` | 1920×1147 | `/advanced` | All tools | P5 |

**Not in the baseline** (take a before screenshot into `dbu6/tmp/redesign/<step>/` before
changing them, if you need a comparison):
- accounts table and new-account form
- the other reports
- freeform import, reclassify, post drafts, render hledger
- journals and raw tables
- sign-in, profile and workspace settings screens
- mobile widths, and the collapsed sidebar, rail and drawer

### 6.8 Shell depth analysis (2026-09-15)

**Question:** is it simpler to make Sapporta's shell customisable enough for 2a, or to inline
it into dbu6? The shell has two layers, and they answer differently.

| Layer | Sapporta code (`packages/frontend/src/shell/`) | Size | Interface | Verdict |
|---|---|---|---|---|
| **Behaviour** | `sidebar-controller.tsx` (`SidebarProvider`, `useSidebar`), `SidebarRegion.tsx` + `.css`, `SidebarDrawer.tsx`, `SidebarToggle.tsx`, `navigation.ts`, `AuthAccountMenu.tsx`/`AccountMenu.tsx` (`renderTrigger`), `Page.tsx` (`PageFrame`, `PageBody`), `document-title.ts` | About 500 lines; most of the 418-line `SidebarArchitecture.test.ts` covers it | Small; all exported from `@sapporta/frontend/shell` | **Keep importing** |
| **Presentation** | `AppShell.tsx` layout, `Sidebar.tsx` (`SidebarHeader`, `NavSection`, `NavItem`, `AppSidebar`, `NavigationRail`, `MobileBottomNav`, `NavigationPicker`), `SidebarShell.tsx`, `PageHeader.tsx` | About 400 lines, mostly markup and class strings | Would grow one-for-one with the markup | **Inline into dbu6** |

**Evidence that customising the presentation layer would be an onion**
- **The sidebar.** Matching §4.6 through Sapporta would take about 25 new props and tokens:
  - a brand slot;
  - a badge field and its styling;
  - optional section labels, with separator spacing;
  - about nine nav-item tokens (padding, radius, size, weight, and the active background,
    text colour, weight and shadow);
  - a smaller style for the second group;
  - the footer as a card instead of a border-top;
  - header and nav padding;
  - the width.

  That is roughly one option per class string in about 120 lines of markup.
- **The page header.** Every 2a screen has a different header:
  - Home: date eyebrow plus display greeting;
  - Import and All tools: title plus description;
  - Review: title, a meta line, and the primary button with a reason beneath it;
  - Report: title plus preset pills.

  A header component covering these needs six or more slots and variants, where each page
  could write ten lines of JSX.
- **Behaviour dbu6 won't need.** The rail's "first 8 items plus the active one" and the bottom
  bar's "3 items plus a Browse picker" exist because Sapporta's navigation has no size limit.
  After P0, dbu6 has 7 items.

**Where the behaviour primitives leak** (found by tracing what `AppShell` does implicitly;
fixed in Step 3)
1. **Width.** `SidebarRegion.tsx` (twice) and `SidebarDrawer.tsx` hardcode `w-[240px]`, so the
   reusable region dictates the width of whatever it holds.
2. **Toasts.**
   - `auth/components/WorkspaceSettingsPage.tsx` and `ChangePasswordPage.tsx` call `toast()`
     from Sapporta's copy of `sonner`.
   - Only `AppShell` renders the matching `<Toaster>`.
   - A Toaster that dbu6 renders from its own copy is a different instance, so those toasts
     would silently not appear.
3. **The header-inset DOM contract.**
   - `PageHeader.css` adds left padding through
     `[data-shell-sidebar-toggle] ~ [data-shell-scroll-region] [data-page-header]`, so a header
     doesn't sit under the content-side sidebar toggle.
   - Sapporta's own screens keep rendering `PageHeader`: tables (`TableGridView`,
     `TableGridHeader`), the report frame (`ReportChrome`), and the profile screens.
   - Any shell that shows a toggle in the content area must meet this contract.
4. **Dark mode on import.** Importing `@sapporta/frontend/shell` for `SidebarProvider` still
   loads the theme store's side effect. That is already a Step 2 fix.

**Also found**
- `bg-sap-active-nav` is used beyond the nav. It is also the background of the identity tiles
  in `AccountProfilePage.tsx`, `ChangePasswordPage.tsx`, `WorkspaceSettingsPage.tsx` and the
  avatar in `AccountMenu.tsx`. So `--sap-active-nav-bg` must stay a visible fill, not white.
- dbu6's frontend can't resolve `@base-ui/react`, `sonner`, `class-variance-authority` or `clsx`
  (§2.3).

---

## 7. Step 2: Foundation

**Goal.** Every screen, including Sapporta's, renders in the 2a palette, fonts, type scale,
heights and radii, with layouts unchanged. Fix the Sapporta bugs that stop tokens from applying.

**Prerequisites.** D1, D2, D3 and D6 decided. D7 decided for the popover shadow.

**Read first.** §2, §4.2–4.5, §6.2–6.4.

**Out of scope.**
- The sidebar's structure (Step 3).
- Fixed pixel values in grid, table and report chrome (Step 4).
- New components and page code (Step 5).

### Sapporta tasks (generic; no dbu6 values)
- [x] **`cn()`:** `extendTailwindMerge` with the `sap-*` text, tracking and height scales;
      `extendCn({ text, tracking, spacing })` registers an app's own. Test:
      `packages/ui/src/ui/utils/cn.test.ts`.
- [x] **Border colour:** `--border` alias, `--color-border` in `@theme`, and a `@layer base`
      `border-color: var(--border)` rule.
- [x] **Undefined tokens:** replaced with `--sap-nested-bg`, `--sap-fg-muted` and
      `--sap-fg-subtle` where they were used (`table-card.css`, `tgrid-cell-links.css`,
      `RecordDetailSheet.tsx`). No new tokens.
- [x] **`--accent`:** now `var(--sap-row-hover)`.
- [x] **Split numeric-negative from danger** (D6): `--sap-numeric-negative` (defaults to
      `--sap-negative`), used by `NumericCell.tsx` and `ReportSummaryStats`' negative tone.
      `--sap-negative` stays the error/danger colour. No attention token (D6).
- [x] **Theme store:** `useDocumentTheme()` applies the mode (called by `AppShell`);
      `forceMode(mode | null)` pins it. Test: `shell/state/theme-store.test.ts`.
- [x] **Radii:** raw values moved to `--sap-radius-*`; `@theme inline` and the `--radius*`
      aliases point at them.
- [x] **Editable focus ring:** the rule is now `.sapporta-table-grid.sapporta-table-grid--editable`.
- [x] ~~**Only if D2 = (b)**~~ D2 is (a); nothing to do.
- [x] **Changesets and commits:** three changesets (ui minor, grid patch, frontend minor);
      commits `d72e71a9`, `e905f48e`, `5e77fd96` on `dbu6-redesign`.

### dbu6 tasks
- [x] **Before screenshots** of the five redesigned screens: done by the owner (§6.7).
      Take extra before screenshots only for routes the baseline doesn't cover that you need
      to compare.
- [x] **Fonts:** in `packages/frontend/index.html`, add
      `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` and
      `https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap`.
- [x] **`app.css` section 1:** set the canonical `--sap-*` values (table below), plus the alias
      overrides `--primary`, `--primary-foreground`, `--ring`, `--destructive`, `--border`,
      `--input`. Keep `--accent` neutral.
- [x] **`app.css` section 2, 2a extra tokens:** `--ink-soft`, `--ink-meta`, `--line-inner`,
      `--money-in-*`, `--attention-*`, `--waiting-*`, `--cat-*` (§4.3, with seed-name
      aliases). The shadows live only in section 3, so their names aren't self-referencing.
- [x] **`app.css` section 3, trailing `@theme inline`:**
  - `--font-sans: "Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif`;
  - `--font-mono: "IBM Plex Mono", ui-monospace, monospace`;
  - the Sapporta tier remap and heights (tables below);
  - the 2a type utilities from §4.4, with line-height, tracking and weight sub-properties;
  - `--radius-control`, `--radius-card`;
  - `--shadow-card`, `--shadow-pill`;
  - `--color-*` entries for the section 2 tokens.
- [x] **`app.css` section 4, unlayered base rules:**
  - `body { font-size: 17px; line-height: 1.5; -webkit-font-smoothing: antialiased }`;
  - `.tnum { font-variant-numeric: tabular-nums }`;
  - link colour and hover for unclassed links under `[data-shell-scroll-region]`.
- [x] **`main.tsx`:** `extendCn({ text: [display, title, heading, subheading, body, row,
      meta, label] })` and `useThemeStore.getState().forceMode("light")` before render.
- [x] ~~**Stopgap** for dark mode~~ not needed: the Sapporta change landed in the same step.
- [x] **Contrast:** every pairing in §4.2 checked; the lowest is destructive on white at 5.4:1.
- [x] **After screenshots** in `dbu6/tmp/redesign/step-2/` (baseline names, plus
      `login`, `tables-accounts`, `setup-accounts-new`, `reports-balance-sheet`,
      `account-profile`, `workspace-settings`, each with a `-390` variant).

**Colour mapping (Sapporta token → 2a)**

| Token | Now | 2a |
|---|---|---|
| `--sap-bg`, `--sap-surface`, `--sap-row` | `#fff` | `#FFFFFF` |
| `--sap-sidebar` | `#fafafa` | `#F6F7F7` |
| `--sap-nested-bg` (→ `--muted`) | `#fff` | `#F8F9F9` |
| `--sap-chip-bg` (→ `--secondary`) | `#eee` | `#F6F7F7` |
| `--sap-row-hover` | `#f4f4f5` | `#F8F9F9` |
| `--sap-selection` | `#eee` | `#F8F9F9` (tune if it can't be told apart from hover) |
| `--sap-border` / `-strong` / `-soft` | zinc | `#E4E6E6` / `#D2D5D5` / `#EDEFEF` |
| `--sap-fg` / `-fg-soft` / `-fg-muted` / `-fg-subtle` | zinc | `#141616` / `#4B4F4F` / `#5B5F5F` / `#5F6363` (2a has no text lighter than 6.4:1) |
| `--sap-brand` / `-brand-soft` / `-focus-ring` | brown | `#2C6A4F` / `#EEF5F0` / `rgb(44 106 79 / .4)` |
| `--sap-link`, `--sap-drill-down-link`, `--sap-loading-indicator-bar` | blue | `#2C6A4F` (`--sap-drill-down-link-soft`: green at 12%) |
| `--sap-positive` | `#1a4d2e` | `#2C6A4F` |
| `--sap-negative` / `--sap-warning` | red / amber | per D6: numeric-negative → `#141616`, danger → `#B4472C`, warning → attention ink `#1B4A80` |
| `--sap-active-nav-bg` | `#ededed` | `#EEF0F0`. Not white: Sapporta also uses it for identity tiles on profile and settings screens (§6.8). dbu6's own sidebar doesn't use this token. |
| `--sap-nav-count-bg` | `#eee` | leave (unused by any Sapporta component; dbu6's badge uses `--attention`) |
| `--sap-proj-chip-kbd-bg` | `#f7f6f3` (warm) | `#F6F7F7` |
| `--primary` / `--ring` | ink / brown | `#2C6A4F` |
| `--destructive` | `#8b2f2f` | `#B4472C` |
| `--accent` | active-nav grey | `#F8F9F9` (neutral hover, not the handoff's blue) |

**Sapporta type tiers → 2a (a starting point; tune from screenshots)**

| Tier | Now | Proposed | Role |
|---|---|---|---|
| `sap-tiny` | 9 | 11 | sort glyphs (not text) |
| `sap-micro`, `sap-label` | 10, 10.5 | 13 | uppercase labels, column headers (= `text-label`) |
| `sap-meta` | 11 | 14 | meta, status (= `text-meta`) |
| `sap-menu` | 11.5 | 15 | menus, select cells |
| `sap-data` | 12 | 15 | inline data, mono figures |
| `sap-emph`, `sap-body` | 12.5, 13 | 16 | buttons, rows, nav (= `text-row`) |
| `sap-mark` | 14.5 | 16 | wordmark |
| `sap-display` | 18 | 23 | stat values (= `text-heading`) |

**Heights and radii (proposed)**
- **Heights:** `sap-row` 32 → 48 · `sap-header` 29 → 44 · `sap-ctl` 30 → 44 · `sap-bar` 24 → 32 ·
  `sap-topbar` 52 → unchanged until Step 3.
- **Radii:** `--sap-radius-sm` 3 → 6 · `--sap-radius` 6 → 11 (controls) · `--sap-radius-lg`
  8 → 14 · `--sap-radius-xl` 10 → 16 (cards).

**Done when**
- Every route in §6.5 renders with 2a colours and fonts, and has no brown, amber or blue-link tint.
- Body text is 17px and framework text follows the remapped tiers.
- Dialogs and popovers have `#E4E6E6` borders.
- An OS set to dark mode still gets light.
- `pnpm typecheck` and `pnpm test` pass in both repos, including the new `cn()` test.
- After screenshots are saved next to the §6.7 baseline for comparison, and the progress log
  is updated.

---

## 8. Step 3: App shell

**Goal.**
- dbu6 renders its **own** app shell (D4), built on Sapporta's behaviour primitives.
- Its sidebar follows §4.6 (Sidebar), with **today's navigation items and groups unchanged**
  and today's behaviour kept: collapse, hover reveal, drawer, rail, mobile bottom bar.
- Collapsing the navigation to 5 + 2 items is Step 6, page P0.

**Prerequisites.** Step 2 merged (includes the theme-store fix). D4 decided.

**Read first.** §2.3 (single copies), §4.6 Sidebar, §6.8, and Sapporta's
`packages/frontend/src/shell/components/AppShell.tsx` and `Sidebar.tsx` (the behaviour to carry over).

**Out of scope.**
- New routes, renaming nav items, the Home page, grid and table chrome.
- Switching dbu6's existing pages off `AppPage`. They keep today's header until their Step 6
  page redesign.

### Sapporta tasks (behaviour leaks only, §6.8; no new props, slots or nav tokens)
- [x] **Sidebar width.** `SidebarRegion` and `SidebarDrawer` size to their content (`w-auto`);
      `SidebarShell` keeps 240px. `SidebarArchitecture.test.ts` updated.
- [x] **Toaster.** `Toaster` (sonner's) is exported from `@sapporta/frontend/shell`. It must be
      rendered **above `BootLoader`**: a time zone change or workspace switch resets the schema
      store, the gate remounts everything under it, and a toast posted then needs an outlet
      that stayed mounted. Sapporta's own `AppShell` renders its Toaster under the gate in
      generated apps, so it misses those toasts too (follow-up in §13).
- [x] **Header inset.** `PageHeader.css` is gone. A shell sets `--sap-page-header-inset` on its
      scroll region while its content-side toggle is present; `PageHeader` (and the narrow
      table header in `TableGridHeader.tsx`, which is its own `data-page-header`) add it to
      their leading padding. `AppShell` sets `3rem`.
- [x] **`PageHeader` title.** `text-sap-body font-bold`; subtitle `text-sap-menu`.
- [x] **Changeset** `app-owned-shell.md` (frontend minor); no subpath changed. Also fixed:
      a custom `AccountMenu` trigger always had `aria-expanded="true"`.

### dbu6 tasks
- [x] **Before screenshots** in `dbu6/tmp/redesign/step-3/before-shell-*.png` at 1920px
      (expanded, collapsed, collapsed with hover reveal), 900px (rail, drawer) and 390px
      (bottom bar, drawer, Browse picker). After screenshots: `after-shell-*.png`, plus
      `after-workspace-settings-toast.png`.
- [x] **`src/shell/AppShell.tsx`.** Replaces Sapporta's `AppShell` in both route groups of
      `src/SapportaApp.tsx`, and drops `showFrameworkNavigation`. Carry over today's behaviour:
  - navigation only for an authenticated session (`useAuthStore`);
  - the schema load error shown in an `AppPage` (`useSchemaStore`);
  - `SidebarProvider` → `SidebarRegion` around dbu6's sidebar;
  - the toggle placed inside the sidebar while the desktop sidebar is expanded, otherwise at
    the content's top-left;
  - `main` as the single scroll region, with bottom padding when the mobile bar shows;
  - the header-inset contract from the Sapporta task above;
  - the Sapporta `Toaster` export, styled per 2a (`text-body`), rendered in
    `SapportaApp.tsx` above `BootLoader` (see the Sapporta task).
- [x] **`src/shell/Sidebar.tsx`,** per §4.6:
  - header: 34px green tile, "dbu6", and the workspace name from the auth context;
  - today's section labels kept, in `text-label` style. 2a has no labels and a separator
    instead, but that goes with P0's 7-item navigation;
  - nav item: inactive `ink-soft`/400, active white pill with `shadow-pill` and weight 600,
    18px icons;
  - a badge on an item;
  - the footer card through `AuthAccountMenu renderTrigger`;
  - 248px wide.
- [x] **Rail and mobile bottom bar.** Ported (the first 8 items plus the active one; the first
      3 plus a Browse picker), restyled to 2a; compact items show a blue dot for a badge.
      P0 decides whether 7 items still need them.
- [x] **Badge.** `src/shell/navigation-counts.ts` reads the table API's `meta.total` for
      drafts with no category. It refetches on each route change (cheap, `limit=1`), so the
      badge stays honest after categorising. `NavigationItem.badge` is dbu6's extension of
      Sapporta's item type (`src/shell/navigation.ts`); `App.tsx` sets it on "Draft entries".
- [x] **Dependencies.** No `sonner` copy. `happy-dom` and `use-sync-external-store` added as
      dev dependencies (the latter only so vitest can dedupe it, see the log).
- [x] **Tests** in `src/shell/AppShell.test.tsx` (happy-dom): no navigation without a session;
      toggle placement expanded vs. collapsed, with the inset variable; the opener on an
      unwrapped compact page; workspace name and account card; badge shown and hidden at zero.

**Done when**
- The sidebar matches §4.6 visually with the current items: header, active pill, badge with a
  real count, separators, footer card, 248px.
- Collapse, hover reveal, the drawer, the rail and the mobile bottom bar work as before (compare
  with the Step 3 before screenshots).
- On Sapporta-rendered screens (`/tables/accounts`, `/reports/balance-sheet`,
  `/account/profile`), the header isn't covered by the collapsed-sidebar toggle.
- Saving on `/workspace/settings` shows its toast.
- dbu6 no longer imports `AppShell`. Checks pass in both repos. Screenshots saved and progress
  log updated.

---

## 9. Step 4: Sapporta work surfaces

**Goal.** Sapporta's grid, table page, report frame, primitives, forms, dialogs and auth
screens reach the 2a scale with no leftover fixed sizes. 44px or larger targets, 11px control
radius, 16px card radius.

**Prerequisites.** Step 2 merged. D2, D5, D6 and D7 decided.

**Read first.** §2.2, §4.5–4.7, §6.3 (grid, primitives and auth rows, plus the grid override notes).

**Out of scope.** dbu6 page code, and domain components (Step 5).

**Depth rule for this step (D1).**
- **Map fixed values onto what already exists:** `--text-sap-*`, `--height-sap-*`, `--radius*`,
  the colour tokens.
- **Add a new token only when one name controls several sites,** e.g. the D7 elevation token.
- **Don't mint single-use tokens** such as a card-label size. If dbu6 needs a one-off size on a
  grid part, set it through the stable `data-grid-part` hooks in `app.css` section 6.
- **Don't add variants or slots to Sapporta components for 2a.** dbu6 owns those components (D4, D5).

### Tasks (Sapporta unless noted)
- [x] **Grid variables.** `.presetGrid` reads `var(--sap-grid-<name>, <default>)` for cell
      padding, header weight/tracking/cell padding, row-header width (40/30px), nested row
      height (31px) and indents (58/46px); the names are listed at the top of
      `sapporta-preset.module.css`. The report grid's indent is
      `--sap-report-grid-nested-indent`. dbu6 sets its values in `app.css` section 6.
- [x] **Fixed grid sizes → existing tiers** (`sapporta-preset.module.css`, `table-card.css`,
      `ReportGridDataset.css`, `TGrid.tsx`, `ReportGridDataset.tsx`):
  - card label 12px → a text tier; card title 15px and level titles `text-[11px]` → text tiers;
  - card radius 6px → `--radius`;
  - popover shadow → the D7 elevation token;
  - status band padding.

  Leave the expand chevron (28px), cell action buttons (24px), header menu button (16px) and
  nested indents (58/46px, report 18px) fixed, unless the 2a scale makes them unusable. Then
  derive them from `--height-sap-*`.
- [x] **Column widths:** the numeric track is a fixed 112px, sized for 12px mono; at 15px a
      lakh-scale figure needs about 128px. `columnSizing.minWidths` (per named width kind)
      raises a floor and lifts the ceiling with it; `TGrid` and `ReportGridDataset` take
      `columnSizing`. dbu6's report frame passes `{ numeric: 128, timestamp: 176 }`. The
      table route (`SchemaTableGridView`) has no pass-through yet (follow-up).
- [x] **Stable hooks:** `data-grid-part` on the selection summary's content, labels and
      values, the text cell, and the level status text.
- [x] **Table page chrome** (about 40 fixed values) → radius and height tokens:
  - `table/page/`: `TablePagers`, `TableHeaderControls`, `TableViewSwitch`, `TableGridHeader`,
    `RecordDetailSheet`, `TableGridSurface`
  - `table/filters/`: `FilterCardsBar`, `FilterCard`, `DateRangeCard`, `ConditionEditor`,
    `HeaderFilterPopover`, `inputs/*`
- [x] **Report chrome:** `report/components/ReportChrome.tsx`, `ReportSummaryStats.tsx`,
      `report/fields/DateRangeField.tsx` → tokens.
- [x] **Primitives** (`packages/ui/src/ui/primitives`), token fixes only (D5):
  - Button, Badge, Input, Checkbox, Switch: heights, radius and type from the existing tiers,
    replacing `h-8`/`h-9`/`h-10`, `text-xs`/`text-sm` and `rounded-md`. No 2a variants; dbu6
    owns its Button.
  - Dialog, Sheet, Popover, Tooltip, ContextMenu: border colour (from Step 2), radius, and the
    elevation token (D7).
  - Kbd: use its inverted token.
  - `styles/combobox.ts`: sizes from the tiers.
  - No new primitives in `@sapporta/ui` (D5).
- [x] **Forms** (`table/form/`): `FormField` and `NewRecordPage` sizes. The textarea still
      copies Input's styles by hand (now on the tiers), with a comment saying so.
- [x] **Auth, profile, workspace settings** (`auth/components/`):
  - `text-sm` → the scale; `text-red-600` → the danger token
  - `bg-sap-brand text-white` → `bg-primary text-primary-foreground`
  - style the links
  - no brand slot (P9 decides whether sign-in gets a branded layout)
- [x] **Boot and not found:** `app/boot/BootLoader.tsx` → the scale (the not-found view had
      no fixed sizes).
- [x] **dbu6:** `app.css` section 6 sets the grid variables (14px cell padding, 600 header
      weight, 44px nested rows, 48/36px row-header gutters) and section 1 sets
      `--sap-shadow-elevated`.
- [x] **Card-layout breakpoint:** unchanged.
- [x] **Changesets** (ui minor, grid minor, frontend minor); no subpath changed. Commits
      `b45d182d`, `fa399dc0`, `4de4cf99` on `dbu6-redesign`.

**Done when**
- `/tables/draft_transactions`, `/tables/accounts`, `/setup/accounts/new`, a report with nested
  levels (e.g. `/reports/balance-sheet`), a filter popover, the record detail sheet, a dialog and
  `/login` all render at the 2a scale.
- Searching the touched Sapporta files finds no leftover `rounded-[5px]`, `rounded-[6px]` or
  `text-[Npx]`.
- Typical amounts and dates aren't cut off in grid columns.
- Checks pass in both repos. Screenshots saved and progress log updated.

---

## 10. Step 5: dbu6 components and token cleanup

**Goal.** (5a) Existing dbu6 pages read correctly under the new theme with no off-token classes.
(5b) The shared domain components exist, ready for Step 6.

**Prerequisites.**
- 5b needs Step 2 merged and D5 decided.
- 5a needs Step 2 merged, plus 5b's `Button`.

**Read first.** §4.4–4.7, §6.4 (dbu6 bugs).

**Out of scope.** Layout, copy or flow changes. Pages that have a handoff screen (Home, Import,
Review, Income & expenses, All tools) get **only** the mechanical cleanup below; they are
rebuilt in Step 6.

### 5a: token cleanup
- [x] **`text-sm`/`text-xs` → the 2a scale:** `text-meta` for helper text, `text-row` or
      `text-body` for content.
- [x] **`bg-nested` and `bg-sap-panel` → real tokens:** `bg-muted`, `bg-card`.
- [x] **Tailwind default palette (`green-*`, `amber-*`) → tokens:** `money-in-*`, `attention-*`,
      `destructive`.
- [x] **Hand-rolled buttons and links → dbu6's `Button` (5b).** `disabled:opacity-50` → the
      waiting style with a reason shown ("Add at least one file", "Choose an account first",
      "Categorize every draft first", and so on). One primary per screen: Import statements
      on Home, Process, Classify rows, Post reviewed entries.
- [x] **`JournalsTable.tsx`:** "Render as hledger" is a table header action (`actions` prop of
      `SchemaTableGridView`).
- [x] **Files:** `src/Welcome.tsx`, `src/Advanced.tsx`, `src/views/AutoImportStatements.tsx`,
      `src/views/import-statements/cards.tsx`, `src/views/ImportFreeformTransactions.tsx`,
      `src/views/ReclassifyDrafts.tsx`, `src/views/PostDrafts.tsx`,
      `src/views/RenderDraftHledger.tsx`, `src/views/AccountImportInputs.tsx`,
      `src/views/JournalsTable.tsx`, the quick filters in
      `src/views/draft-transactions/DraftTransactionsTable.tsx`, and `DateInput` in
      `src/reports/shared.tsx`.

### 5b: dbu6 Button and domain components (`packages/frontend/src/components/`)
Translate the handoff's `components/*.tsx` to this stack:
- react-router instead of next;
- `@sapporta/ui/cn` instead of `@/lib/utils`;
- dbu6's `Button`, and Sapporta's Checkbox and Popover, instead of `@/components/ui/*`.

- [x] **Dependencies.** `class-variance-authority` and `@base-ui/react` (1.6.0, the version
      Sapporta has installed) added; `@base-ui/react` aliased and deduped to one copy in
      `vite.config.ts`. `@tanstack/react-query` likewise (see the log).
- [x] **`components/ui/button.tsx`:** Base UI button, the handoff's variants with `sm` at
      44px, and `waiting="<reason>"`, which disables the button, switches it to the waiting
      fill and shows the reason underneath.
- [x] **Other generic primitives:** none built (D5).
- [x] **`Amount`** (`components/amount.tsx`, with `formatAmount`).
- [x] **`CategoryLabel` and `NeedsCategory`** (`components/category-label.tsx`) on
      `components/category.ts`: `categoryGroup`, `categoryHue` (with the §4.3 aliases),
      `categoryHueColor`, `categoryName`.
- [x] **`StatusChip`, `ProgressSteps`, `NextStepCard`, `EmptyState`, `TransactionRow`.**
- [x] **Unit tests:** `components/amount.test.ts`, `components/category.test.ts`.

**Done when**
- Searching `packages/frontend/src` finds:
  - no `text-(xs|sm)`;
  - no `(bg|text|border)-(green|amber|red|blue)-\d`;
  - no `bg-nested` or `bg-sap-panel`;
  - no hex values outside `app.css` and the category module.
- The components match §4.6.
- Layouts of existing pages are unchanged (compare screenshots).
- `pnpm typecheck` and `pnpm test` pass. Progress log updated.

---

## 11. Step 6: Page by page

Pages are labelled **P0–P9**. Don't confuse them with §6.1–§6.6, which are audit sections.

**How each page goes.**
1. An agent (or the owner) prepares the discussion: the current page (with its baseline
   screenshot, §6.7), the matching §4.8 screen, the data available (§6.6), and the questions below.
2. The owner and agent agree on the layout, arrangement, flow and UX.
3. The agreed spec is written into this section under the page's heading, using the template
   below. The heading's status changes to **Spec agreed (date)**.
4. Only then does an agent build it: data and API changes first, then UI.

**Prerequisites for any page.** Steps 2–5 are done. For P1–P9, P0 is done. The page's
spec is agreed.

**Spec template**
```
Status: Not started | In discussion | Spec agreed (date) | Built (date)
Purpose and single primary action:
Route(s) and redirects:
Section order (with layout notes):
Copy (titles, descriptions, button labels, empty/error text):
States: empty · loading · error · large volume
Data and API changes (endpoints, mutations, contracts in dbu6-shared):
Components used (§4.6 + primitives):
Old screens retired or folded in:
Done criteria (page-specific, plus §4.9):
```

### P0 · Navigation and routes: Status: Built (2026-09-15)

Agreed with the project owner on 2026-09-15, one question at a time. Build order: routes
and redirects, then the sidebar and shell, then the reports index, then All tools' missing
links, then tests and screenshots.

**Purpose and single primary action:** navigation only. No screen in P0 has a primary
action; the reports index is a list of links.

**Route(s) and redirects**

Sidebar items, in order (5 everyday, a rule, 1 more):

| Item | Route | Renders in P0 (until the page's own step) | Old path, now a redirect |
|---|---|---|---|
| Home | `/` | today's `Welcome` (until P1) | `/welcome` → `/` |
| Accounts | `/accounts` | Sapporta's `TablePage` bound to `accounts` (until P6) | `/tables/accounts` → `/accounts` |
| Import statements | `/import` | `AutoImportStatements` (until P2) | `/views/import-statements` → `/import` |
| Review (badge) | `/review` | `DraftTransactionsTable` (until P3) | `/tables/draft_transactions` → `/review` |
| Reports | `/reports` | the new reports index (this step) | `/reports/:unknown` → `/reports` (was trial balance) |
| All tools | `/tools` | `Advanced` (until P5) | `/advanced` → `/tools` |

- **Help & support is left out.** Decided: nothing exists behind it; add the item when there
  is content. The sidebar is 5 + 1, not the handoff's 5 + 2.
- **`/` is protected.** The public shell route for `/welcome` goes; a signed-out visit to `/`
  reaches sign-in through `AuthGate`. `appPublicShellRoutes` becomes empty.
- **Tool URLs stay where they are.** `/views/import-freeform-transactions`,
  `/views/reclassify-drafts`, `/views/render-draft-hledger`, `/views/post-drafts`,
  `/tables/journals`, `/tables/:tableName`, `/tables/:tableName/new`, `/setup/:tableName/new`
  and every `/reports/<id>` keep working unchanged. They are what All tools links to.
- **Redirects** are `<Navigate replace>` routes in `App.tsx`. `defaultReportPath` is retired;
  the unknown-report fallback lands on the index.
- **Internal links** move to the new paths where the target has one: `Welcome.tsx`,
  `Advanced.tsx`, `views/PostDrafts.tsx`, `views/ImportFreeformTransactions.tsx`,
  `views/import-statements/describeGroup.ts`. The redirects cover anything missed.
- **Active-item rule:** Sapporta's `isNavigationItemActive` already treats `/` as exact and
  every other item as a prefix, so `/reports/<id>` highlights Reports and `/tables/journals`
  highlights nothing. No change.

**Section order (with layout notes)**

- **Sidebar** (dbu6's `Sidebar.tsx`, 248px, §4.6): header (brand tile, "dbu6", workspace
  name, collapse toggle) → the five everyday items → a rule (`mx-5 my-3.5`, `--sap-border`)
  → All tools in the secondary style (15px, `py-2.5`) → the account card. **No group labels.**
- **Icons stay everywhere**, 18px monochrome Lucide, one per item, shared by the sidebar,
  the drawer and the bottom bar: `Home`, `Landmark` (Accounts), `FileUp` (Import
  statements), `ListChecks` (Review), `BarChart3` (Reports), `Settings2` (All tools).
- **Shell simplification (D4):** delete `NavigationRail`, `NavigationPicker`,
  `includeActiveRailItem` and the `RAIL_ITEMS`/`BOTTOM_BAR_ITEMS` logic. Medium widths use
  the toggle and the drawer, as compact screens do. The **mobile bottom bar shows the five
  everyday items**; All tools is reached from the drawer. The dbu6 `Navigation` type becomes
  two named lists, `everyday` and `more`, instead of labelled sections; `navigationItems`
  flattens both.
- **Reports index** (`/reports`, new `src/reports/ReportsIndex.tsx`, on `AppPage` or the
  Advanced page frame): title and description → "Everyday" group, six cards → a rule →
  "Accounting view" group, eight cards. Cards are the link card `Advanced.tsx` already
  renders (name, one-line description, arrow), extracted into
  `src/components/link-card.tsx` so both screens share it, with the handoff's green marker
  on everyday cards and grey on accounting ones. Two columns at desktop, one at 390px.

**Copy**

- Sidebar labels: Home · Accounts · Import statements · Review · Reports · All tools.
- Reports index title: "Reports". Description: "Every report dbu6 can show. The everyday
  ones use plain words; the accounting view shows the same books the way a bookkeeper
  would."
- Everyday cards (handoff names, mapped to today's reports):
  - Where your money went, "Income and spending for a period" → `income-statement`
  - What you own and owe, "Balance sheet, in plain words" → `balance-sheet`
  - Account history, "Every entry for one account" → `account-ledger`
  - Month by month, "Totals for each month side by side" → `monthly-summary`
  - Net worth over time, "How your position has changed" → `net-worth`
  - Spending breakdown, "Expenses grouped and ranked" → `expense-breakdown`
- Accounting cards:
  - Income statement, "Revenue, expenses and net income" → `income-statement`
  - Balance sheet, "Assets, liabilities and equity" → `balance-sheet`
  - Trial balance, "Debit and credit totals per account" → `trial-balance`
  - All in-flows to asset accounts, "Every rupee that arrived" → `asset-inflows`
  - Balance assertions, "Recorded balance checks" → `balance-assertions`
  - Draft balance assertions, "Balance checks for drafts not yet added" → `draft-balance-assertions`
  - Duplicate drafts, "Drafts that may be repeats" → `duplicate-drafts`
  - Import checkpoint, "The last date and balance recorded for each account" → `last-reconciled`
- Until P4 and P7 build the plain-language versions, "Where your money went" and "Income
  statement" open the same screen, as do "What you own and owe" and "Balance sheet". That
  is expected; note it in the card's description only if it confuses in testing.
- The registry's labels (`reports/registry.tsx`) gain the plain and accounting names and
  descriptions above, so All tools and the index read from one list.

**States:** the index is static (no loading or error state). The Review badge is hidden at
zero and when the count fails to load, as today.

**Data and API changes:** none. The badge keeps reading the draft table's null-category row
count (`navigation-counts.ts`) once per route change at shell level, which is the handoff's
"fetch once at layout level". A dedicated counts endpoint is a P3 follow-up if needed.

**Components used:** dbu6 `Sidebar`/`AppShell` (D4) on Sapporta's `SidebarProvider`,
`SidebarRegion`, `SidebarToggle`, `AuthAccountMenu`, `isNavigationItemActive`; Sapporta's
`TablePage` for the interim Accounts route; the shared link card; `AppPage`.

**Old screens retired or folded in**

- Retired: the public `/welcome` route; the seven sidebar groups and their labels; the rail,
  the Browse picker and the overflow logic; `defaultReportPath`.
- Nothing else is removed. Every old sidebar link is reachable from All tools: the tables
  and reports already are; **P0 adds "Import freeform transactions" to All tools' tool
  list**, since it is on no other screen after the sidebar changes. "Add an account" is the
  accounts table's own New button and `/setup/accounts/new` keeps working.
- Classify drafts, Check duplicates, Verify balances and Post reviewed entries stay as
  screens under All tools until P3 decides what folds into Review.

**Done criteria (page-specific, plus §4.9)**

- The sidebar shows exactly the six items above with the rule, no labels, the badge on
  Review, and the account card; at 390px the bottom bar shows the five everyday items and
  the drawer shows all six.
- Every route in the old sidebar and §6.5 either still renders or redirects to its new path
  (a test walks the redirect table); `/` signed out reaches sign-in.
- The reports index lists all twelve reports in the two groups and each card opens its report.
- Every old sidebar destination is linked from `/tools`.
- `AppShell.test.tsx` updated (rail cases removed, bottom bar and badge-on-Review cases added).
- `pnpm typecheck`, `pnpm test`, `pnpm format:check`; screenshots at 1920 and 390 in
  `tmp/redesign/p0/` for `/`, `/accounts`, `/import`, `/review`, `/reports`, `/tools` and
  the drawer.

### P1 · Home (handoff: Home): Status: Built (2026-09-15)

Agreed with the project owner on 2026-09-15, one question at a time. Build order: the
`home` contract and handler with tests, the state function with tests, then the page.

**Purpose and single primary action:** say where the books stand and give one thing to do.
Home is about the reconciled situation of each importable account, which accounts have
drafts waiting, and whatever blocks posting, said plainly. **There is no "month so far"
card**: the owner wants figures on the reports, not on Home. The one primary action is the
next-step card's button.

**Route(s) and redirects:** `/` (P0). `usePageTitle("Home")`. No new routes.
`/reports/last-reconciled` stays as the Import checkpoint report on All tools; Home takes
over its role for everyday use.

**Section order (with layout notes)**

1. **Date eyebrow** ("Tuesday, 15 September 2026", `text-label` uppercase `ink-meta`).
2. **Greeting** in `text-display`, chosen by the state (below), with the workspace name
   under it in `text-body ink-meta` as the household line (renamed in workspace settings).
3. **NextStepCard**, one per page, chosen by the state. The medallion shows a count only in
   states 3–5; `NextStepCard` gets an optional `count` (no medallion when absent).
4. **"Your accounts" card**: header (`text-heading`) with a ghost "Add an account" → `/accounts`;
   one row per account (below); an `EmptyState` when there are none.

No `ProgressSteps` (decided: the card and the rows already say where the user is). Page
frame as the handoff: `px-14 py-10` at desktop, a single column, content width about
1040px; at 390px everything stacks and the card's action sits under its text.

**What an account is (decided, revised once).** The unique `base_account` paths across every
import preset (`readImportPresets`), resolved to ledger accounts by name. Not a path-prefix
rule (bank accounts need not live under `assets:bank`), and not the raw accounts table.
`kind` is card when any preset for that account sets `is_credit_card`. The row's name is the
preset's `name` when exactly one preset points at the account, otherwise the path's last
segment made readable (as `categoryName` does); the path is the `title`.

**Account row (facts only, no staleness guess):**
- name (16.5px/600), linking to the account ledger (`accountLedgerHref`);
- subline (`text-meta ink-meta`): "Checked to 13 Sep · ₹3,26,445" from the last posted
  balance assertion (the checkpoint query), or "Nothing imported yet";
- status chip, in this order: **problem** "Problems in drafts" when its drafts have failing
  balance checks or possible duplicates; **attention** "12 drafts waiting" when it has
  drafts; **ok** "Checked" when it has a checkpoint and no drafts; **waiting** "Not imported"
  otherwise. A preset whose base account is not in the ledger shows "Account missing"
  (problem) with the path.

**The state, in precedence order** (a pure function of the `home` response; decided:
problems before categories, since a wrong balance usually means a wrong or missing
statement):

| # | Condition | Greeting | Card title / body / button |
|---|---|---|---|
| 1 | no accounts (no presets) | "Let's set up your first account" | "Add your first account" / "dbu6 imports statements from the banks and cards you set up. Each needs an account and an import preset." / "Open accounts" → `/accounts` |
| 2 | accounts, but no drafts and no journals on any of them | "Nothing imported yet" | "Import your first statement" / "Drop in a statement from HDFC Savings or ICICI Amazon Pay. Nothing reaches your books until you've checked it." / "Import statements" → `/import` |
| 3 | failing balance checks or possible duplicates in the drafts | "A few things to fix first" | count = failing + duplicates. Title: "3 balance checks fail in the drafts", or "2 possible duplicate entries in the drafts", or "A few things to fix in the drafts" when both. Body: "They have to be fixed before those drafts can be added to your books." followed by inline links "See the balance checks" (`/reports/draft-balance-assertions`) and "See the duplicates" (`/reports/duplicate-drafts`) until P3 folds them into Review. Button: "Review the drafts" → `/review` |
| 4 | uncategorised drafts | "You're nearly up to date" | count = uncategorised. "12 transactions need a category" / "They're waiting in HDFC Savings's drafts. Nothing is added to your books until you've checked them." / "Review transactions" → `/review` |
| 5 | drafts, all categorised, no problems | "Ready to add to your books" | count = drafts. "21 transactions ready to add" / "The entries are ready for posting." (owner, 2026-09-16: it doesn't say whether everything is categorised or the balances match) / "Add them to my books" → `/views/post-drafts` until P3 |
| 6 | nothing pending | "You're up to date" | "Every account is checked to its last statement" / "Import the next statement when it arrives." / "Import statements" → `/import` |

When drafts sit on several accounts, the body names them ("across HDFC Savings and ICICI
Amazon Pay"). Counts in titles use `plural`.

**Copy** is in the table. Card header "Your accounts"; empty state "No accounts set up yet"
/ "Add a bank or card account and an import preset, then import its first statement." with
an outline "Open accounts". Sublines as above.

**States:** *loading*: the card and the accounts card keep their shape (a card-height
skeleton each; no spinner). *error*: the backend error word for word where the card would
be, with a "Try again" outline button. *empty*: state 1. *large volume*: every account is
listed, no paging (presets are a handful).

**Data and API changes**
- **New contract in `dbu6-shared`: `homeContract.summary`, `GET /home`** (auth as the
  workflow endpoints, `requireWorkflowAuth`; scope as reports). Response:
  ```
  {
    accounts: [{ account_id: number | null, path, name, kind: "bank" | "card",
                 checked_to: string | null, checked_balance: number | null,
                 drafts, uncategorised, duplicates, failing_checks }],
    totals: { drafts, uncategorised, duplicates, failing_checks },
    has_journals: boolean
  }
  ```
- **Handler `packages/api/app/home.ts`** composes existing queries: `readImportPresets`
  (unique base accounts), `loadLastReconciled` (already exported), the draft counts by
  `base_account_id` (total and `account_id IS NULL`), `failingDraftAssertionsSelect` grouped
  by account, and the duplicate-drafts query grouped by base account (move that SQL into a
  shared module if the report keeps it inline). A test per state with a seeded SQLite, as
  the report tests do.
- **Frontend:** `homeApi` in `src/api.ts`; `src/home/state.ts` (`homeState(summary)` →
  the state number, greeting and card content) with a test per state; `src/home/Home.tsx`
  replaces `Welcome.tsx`.
- **Badge:** unchanged for now (`totals.uncategorised` is the same number; switching the
  sidebar to it is a follow-up).

**Components used:** `NextStepCard` (count made optional), `StatusChip`, `EmptyState`,
dbu6 `Button` (default, outline, ghost), `accountLedgerHref`, `plural` from the import
formatting module, a mono balance span (not `Amount`: a balance has no direction).

**Old screens retired or folded in:** `Welcome.tsx` and its five-section workflow wall go.
Its guidance text is not kept (Help & support was left out in P0). The Import checkpoint
report stays on All tools.

**Done criteria (page-specific, plus §4.9)**
- `homeState` has a passing test for each of the six states, and the handler a test for
  the counts and the checkpoint on seeded data.
- With the seed, Home shows state 3 or 4 with the HDFC Savings drafts and the account
  rows; after posting, state 6. Screenshots of both at 1920 and 390 in `tmp/redesign/p1/`.
- The page makes one request. No colon paths outside `title` attributes.
- `pnpm typecheck`, `pnpm test`, `pnpm format:check`.

### P2 · Import statements (handoff: Import): Status: Built (2026-09-15)

Agreed with the project owner on 2026-09-15, one question at a time. **The page keeps
today's flow**: drop the files, press one button, and the server imports in one request
(`POST /import-draft/statements/auto`); results or problems appear afterwards. The owner
called the handoff's Import screen a throwaway idea. There is no check-before-import step,
no dry-run endpoint and no "Change" (the preset match is strict, so nothing is guessed).
Server behaviour is unchanged: all or nothing when a file can't be placed, and a partial
import when a later account fails. Build order: the shell's `shortLabel`, then the Import
page (frame, dropzone, file list, Google Pay row, button), then the outcome (results card,
problem cards and their tones), then the freeform screen, then tests and screenshots.

**Purpose and single primary action:** import statement files into drafts. The one primary
button is "Import N statements" before an import (and on retry after a failure), and
"Review N transactions" once an import brought something new.

**Route(s) and redirects:** `/import` (P0). `usePageTitle("Import statements")`. The freeform
screen stays at `/views/import-freeform-transactions`. No new routes. Links that name the
old path move to the new one: `REVIEW_DRAFTS_ROUTE` in `describeGroup.ts` (today
`/views/reclassify-drafts`) becomes `/review`, and `agentPrompts.ts`' mention of
`/views/import-statements` becomes `/import`.

**Section order (with layout notes)**

The frame is Home's: no `AppPage` 52px bar or breadcrumb; the title and description sit at
the top of the content, clear of `--sap-page-header-inset`. A single column about 760px
wide, `px-14 py-10` at desktop; everything stacks at 390px.

1. **Header:** title (`text-title`) and description (`text-body ink-soft`).
2. **Dropzone** (2a: 2px dashed outline border, `#FCFCFC`, 18px radius): "Drop your statement
   files here", the formats line, an outline "Choose files" button. Clicking anywhere in the
   zone opens the picker; "Choose files" is the keyboard path. The native input stays hidden.
   **No extension filter:** the `accept` list, `ACCEPTED_EXTENSIONS` and the "Skipped …"
   message go. Every dropped file is sent, and a type no parser lists comes back
   `unrecognized` ("Readers tried: none fit this file type"), like any unreadable statement.
   Under the zone, one quiet ghost-link line to freeform import.
3. **File list:** one card, headed "3 statements" with a ghost "Clear all". Each row: a type
   tile (the extension uppercased, e.g. XLS), the file name (truncates), the size in mono,
   and a remove button (44px target). After an import, a status line under the name in the
   problem's tone (below), with a glyph.
4. **Google Pay row:** its own row below the statements, styled like a file row. Empty: the
   title, one sentence and an outline "Choose file" (hidden native input, `.html,.htm`).
   Chosen: an HTML type tile, the name, the size and a remove button. A Takeout is added only
   through this row; an `.html` dropped on the dropzone is treated as a statement. It never
   counts towards "N statements".
5. **Button:** the primary import button, with its waiting reason.
6. **Outcome:** the summary sentence, then the problem cards, then the results card.

**The done state** (after a request that imported without failure):
- The dropzone, the Google Pay row and the import button hide. The file list stays, with
  each file's outcome line, and no remove buttons.
- With new transactions: primary "Review N transactions" → `/review` (N = the sum of
  `draft_transaction_count`), and outline "Import more statements", which clears the page.
- With nothing new: "Import more statements" is the only action, and the primary.

**The failure state:** the dropzone and the file list stay (a missing statement can be
added), "Import N statements" stays primary for the retry, and the problem cards explain.
After a partial import, the accounts that imported become rows in the results card and
their files leave the list, as today.

**Results card** (one card, one row per imported account, replacing today's `AccountCard`):
- the account (the preset's name) and a caption: institution · "account ending 0505" ·
  statement dates · file names;
- a status chip: ok "21 new", or waiting "Nothing new";
- the counts as a sentence: "8 in the statement: 5 new, 3 already in your books" ("The
  statement has no transactions." when empty);
- balances: "✓ Balances match the statement" with opening → closing in mono (cards read as
  amounts owed, `formatBalance`), or, in the waiting tone, "Balances not checked: the
  statement prints no closing balance";
- "Named 6 UPI payments from Google Pay", only when `gpay_enriched_count` > 0;
- a collapsed "Details": the "Not new because" breakdown, the ledger account path, the
  parser, the balance sources, the last confirmed balance.
- **Gone:** the six stat tiles, the per-card "Review drafts" button, the hledger journal
  disclosure (Render hledger on All tools covers it). **Not added:** a needs-a-category count.

**Problem cards** (content and behaviour kept, `describeProblems.ts` wording kept):
- **Tone by kind.** Destructive (the numbers don't add up): `balance_mismatch`,
  `segment_balance_mismatch`, `statement_boundary_mismatch` (a gap, or the same statement
  twice), `statement_disagreement`, `statement_part_invalid`,
  `reconciliation_match_failed`, `assertion_conflict`. Attention (something needs setting
  up): `unrecognized`, `ambiguous`, every `unresolved` reason, `opening_balance_unavailable`,
  `closing_balance_unavailable`, `statement_part_unjoinable`, and the permission card (403).
  The cards without a kind of their own take destructive: the connection card and the
  unexpected-error card, which today also covers codes such as `ambiguous_duplicate`,
  `import_account_not_found` and `categorization_config_error`. The summary sentence and each
  file's status line take the tone of the most serious problem, with a "!" glyph.
- **Anatomy:** the file or account and its caption with a "Not imported" status chip; the
  verdict as a `text-subheading`; the facts table (figures in mono; a mismatch always shows
  its computed and printed figures and the difference); the why and the steps as plain
  paragraphs (no label column); the actions as outline buttons; then "Ask your coding agent
  to fix this" (copy prompt, preview) and "Technical details" (the server's words), both
  collapsed.
- **Freeform link:** the unrecognised-file card gains an outline "Import them freeform
  instead" → `/views/import-freeform-transactions`.

**Copy**
- Title "Import statements". Description: "Drop the statement files you downloaded from your
  bank. Each one is matched to its account, so you can drop statements from several banks
  at once. New transactions wait in Review, and your books don't change until you add them."
- Dropzone: "Drop your statement files here" / "PDF, Excel or CSV. Add as many as you like."
  (a hint, not a filter) / "Choose files". Under it: "Transactions that aren't in a
  statement file? Import them freeform".
- File list header: "N statements" (`plural`), "Clear all".
- Google Pay row: "Names from Google Pay (optional)" / "Add the activity page from your
  Google Pay Takeout, and UPI payments get the recipient's name before they're categorised."
  / "Choose file". Today's "It never changes which transactions count as already imported"
  goes.
- Button: "Import N statements" ("Import statement" for one); waiting reason "Add at least
  one statement"; while importing, a spinner and "Importing…" with "Reading, checking and
  categorising. This can take a minute." underneath.
- Summary sentences as `describeBatch.ts` has them today. Every "Process" in
  `describeBatch.ts`, `describeProblems.ts` and the page ("press Process again", "Process
  X on its own") becomes "Import".
- Done state: "Review N transactions", "Import more statements".

**States:** *empty*: the dropzone and the waiting button. *loading*: the button's importing
state; the dropzone, the remove buttons and the Google Pay row are disabled; no skeletons.
*error*: the problem cards (including the connection and permission cards); a network
failure keeps every file. *large volume*: no paging; the file list grows and results have
one row per account.

**Navigation label:** dbu6's `NavigationItem` (`shell/navigation.ts`) gains an optional
`shortLabel`; the mobile bottom bar shows it when present. Import statements sets
`shortLabel: "Import"`. The sidebar, the drawer, the page title and the item's accessible
name keep "Import statements".

**Freeform import** (`views/ImportFreeformTransactions.tsx`, same flow and wording):
- Home's frame instead of `AppPage`; title and description styled as on Import.
- The kind's two native radios become a two-option segmented RadioGroup; the account's
  native `<select>` becomes the Select primitive, still filtered to assets or liabilities.
  Both primitives are added to `components/ui/` on `@base-ui/react` (D5).
- The three numbered steps, the copy-prompt button and the prompt preview stay.

**Data and API changes:** none. P2 is frontend only.

**Components used:** dbu6 `Button` (default, outline, ghost), `StatusChip`, new
`components/ui/radio-group.tsx` and `select.tsx`, a local type tile, the import formatting
module (`plural`, `formatBalance`, `formatDateRange`, `maskIdentifier`), `CopyPromptButton`.

**Old screens retired or folded in:** nothing retired. Gone from the Import page: the
breadcrumb bar, the client-side extension filter and its message, the native Google Pay
input and its long help text, "Process", the per-account `AccountCard` (tiles, per-card
Review button, hledger journal), the label-column layout of `ProblemCard`.

**Done criteria (page-specific, plus §4.9)**
- `describeProblems` gives every error code a tone, with a test for each group; the
  `describeBatch` and `describeGroup` tests follow the new wording and fields.
- In the browser with the seed and the parser fixtures: a successful import (done state,
  "Review N transactions" opens `/review`); a re-import of the same file (nothing new); an
  unrecognised file, including an `.html` dropped on the zone (attention tone, the freeform
  button, "Remove this file" then a retry); a balance problem (destructive tone, the
  figures shown); a Takeout added through its row.
- At 390px the bottom bar reads "Import" in full.
- The freeform screen renders with the new controls and still produces the same prompt.
- No native file input, radio or select is visible on either screen.
- `pnpm typecheck`, `pnpm test`, `pnpm format:check`; screenshots at 1920 and 390 in
  `tmp/redesign/p2/` (empty, files added, done, nothing new, each problem tone, freeform).

### P3 · Review (handoff: Review; replaces Draft entries, Check duplicates, Verify balances, Post reviewed entries): Status: Built (2026-09-16)

Agreed with the project owner on 2026-09-15. **Import doesn't change** (P2 stands): statements
from any number of accounts land in the drafts together, and the drafts can hold any number
of accounts at any time. **Review starts when you pick one account that has drafts.**
Everything after that is scoped to the account: its overview says what blocks posting or
that it's safe to post, and holds the post button; its tabs are the drafts table, the
possible duplicates and the balance checks. Posting already runs per account.

**No Sapporta changes, and categorising works as today** (owner, 2026-09-15): no per-row or
per-selection categorise action, and "Run the categoriser again" is today's Classify drafts
screen, unchanged.

Build order: the draft status module and the `review` contract and handler, with tests;
the report account filter; routes and redirects; the account picker; the account frame and
tabs; Overview with posting; the Drafts tab; the Duplicates and Balance checks tabs with
their prompts; Home's links; tests and screenshots.

**Purpose and single primary action**
- `/review` (the picker): choose an account. No primary button; the rows are links, like
  the reports index.
- `/review/:accountId` (Overview): add this account's drafts to the books. The one primary
  button is "Add N to my books", in the waiting style until every check passes.
- The Drafts, Duplicates and Balance checks tabs have no primary button. Their actions are
  outline buttons ("Run the categoriser again", "Copy prompt").

**Route(s) and redirects**
- `/review`: the account picker. When exactly one account has drafts, it replaces itself
  with `/review/:accountId`. `usePageTitle("Review")`.
- `/review/:accountId`: Overview. `:accountId` is the ledger account's id (the drafts'
  `base_account_id`). A non-numeric id redirects to `/review`.
- `/review/:accountId/drafts`: the Drafts tab. The grid's filters, search and page live in
  its query string, as on today's `/review`.
- `/review/:accountId/duplicates` and `/review/:accountId/balance-checks`: the other tabs.
- Any other path under `/review/:accountId/` redirects to Overview.
- `usePageTitle` on the account pages: "HDFC Savings · Review".
- **Redirects** (`redirects.tsx`, walked by `redirects.test.tsx`): `/views/post-drafts` →
  `/review` is added. `/views/reclassify-drafts` stays as it is.
- **`/tables/draft_transactions` stops redirecting** and shows Sapporta's raw table again
  (every account, as a raw table on All tools). Decided while writing: `/review` no longer
  shows every account's drafts, and the reports' "Open draft transaction" links resolve to
  `/tables/draft_transactions?filter[id]…`, which the redirect sent to the picker without
  the row.
- `/views/render-draft-hledger` stays on All tools (decided).

**Section order (with layout notes)**

The frame is Home's: no `AppPage` bar; the header sits at the top of the content, clear of
`--sap-page-header-inset`; `px-14 py-10` at desktop, `px-5 py-8` at 390px.

*The picker (`/review`)*, a single column about 760px wide:
1. Title and description.
2. One card with a row per account that has drafts, sorted by name. Each row links to
   `/review/:accountId`: the account's name (16.5px/600, the path in `title`), a subline
   (`text-meta ink-meta`) "21 drafts · 1–13 Sep", a status chip, and a "›".
   **Chip precedence:** problem "Problems to fix" when it has failing balance checks or
   possible duplicates; attention "12 need a category"; ok "Ready to add".
3. An `EmptyState` instead of the card when no account has drafts.

*The account frame (every `/review/:accountId` page)*, full content width:
1. **Back link:** ghost "‹ All accounts" → `/review`, shown only when another account also
   has drafts (with one account, `/review` would come straight back).
2. **Header:** the account's name (`text-title`, path in `title`); under it (`text-body
   ink-meta`) "21 drafts · 1–13 Sep 2026 · checked to 31 Aug", or "… · nothing added yet"
   when the account has no posted balance check.
3. **Tabs:** Overview · Drafts 21 · Duplicates 2 · Balance checks 3. They are links (each
   tab is a route), styled as the handoff's pill tabs: the active tab ink-filled with
   `aria-current="page"`; the count in mono after the label; the Duplicates and Balance
   checks counts in the destructive tone when above zero and left out at zero; the Drafts
   count always shown. At 390px the tab row scrolls sideways. Not the Tabs primitive,
   since each tab is its own URL.
4. **The tab's content.** Overview's column is about 760px wide; the other tabs use the
   full width for their grids.

*Overview*:
1. **Verdict** (`text-heading`): "Ready to add to your books", "Not ready to add yet", or
   after posting, "Added to your books".
2. **Checks card**, one row per check, in tab order. Each row: a glyph (✓ ok, ! problem or
   attention, a waiting dot), a sentence, and a ghost link to the tab that fixes it.
   - **Categories:** ✓ "All 21 transactions have a category", or ! (attention) "12
     transactions need a category" with "See them in Drafts" → the Drafts tab with the
     `account_id` is-empty filter in its URL (shown as a chip).
   - **Duplicates:** ✓ "No possible duplicates", or ! (problem) "2 possible duplicates" with
     "See the duplicates".
   - **Balance checks:** ✓ "Every balance check passes", or ! (problem) "3 balance checks
     fail, the first on 5 Sep" with "See the balance checks". When the drafts carry no
     balance check at all (freeform drafts, say): waiting "These drafts have no balance
     checks". That doesn't block posting, since the posting gate doesn't either.
3. **What posting does**, shown only when nothing blocks (`text-body ink-soft`): "Adds 21
   transactions from 1–13 Sep. HDFC Savings will then be checked to 13 Sep at ₹3,26,445."
   The second sentence is left out when the drafts have no balance check. No confirmation
   dialog (decided while writing: the sentence says what happens, and the owner wants to
   press post from here).
4. **The button:** "Add 21 to my books". Waiting reason: the unmet checks in tab order,
   joined with " · ": "12 still need a category · 3 balance checks fail". While posting:
   a spinner and "Adding…".

**After posting** (a 200 response): the verdict reads "Added to your books"; the checks card
is replaced by an ok line: "21 transactions added. HDFC Savings is checked to 13 Sep at
₹3,26,445." Then, if another account has drafts, a primary "Review ICICI Amazon Pay" (the
first by name) and a ghost "All accounts"; otherwise a primary "Import statements" →
`/import`. The tab counts refresh to zero. A 422 (the drafts changed since the page loaded)
shows the server's error word for word above the button, and the summary is fetched again.

*Drafts tab*:
1. **Grid:** today's draft table (`SchemaTableGridView` for `draft_transactions`, with its
   header, search, Export, delete, filters, in-place cell editing and quick filters), locked
   to the account through Sapporta's existing `rootRows.fixedFilters`
   (`[eqCondition("base_account_id", accountId)]`, memoised on the id, since a new array
   recreates the grid's session). The lock is not a filter chip and can't be removed. The
   user's own filters, search and page stay in the URL and show as chips. The quick filters
   keep their labels and write to the tab's URL instead of `/review`. `registerAs` as
   today; no New record button (`onNewRecord` isn't passed).
2. **The grid's header is Sapporta's, unchanged:** it reads "Draft Transactions" with the
   record count, and while this tab is open it names the browser tab.
3. **"Run the categoriser again"**, an outline button above the grid, is a link to today's
   Classify drafts screen (`/views/reclassify-drafts`), unchanged: its presets, account
   picker, custom mapping files text field, optional Google Pay file, and the classify
   requests over that account's drafts with no category. Coming back to Review fetches the
   summary again.
4. **Removing a draft** (the extra one of a duplicate pair) is the grid's own delete.

*Duplicates tab*:
1. **Summary** (`text-body ink-soft`): "2 possible duplicates. Each draft below looks like
   another draft or an entry already in your books. If one is extra, select it in Drafts
   and delete it. If both are real transactions, ask your coding agent to find out why they
   match."
2. **Grid:** the `duplicate-drafts` report for this account (`ReportResultBody`, no report
   frame or Run button), without the Base Account column. Its links to open the draft, the
   matched draft and the matched journal stay.
3. **"Ask your coding agent to find out"**: an outline `CopyPromptButton` and a collapsed
   preview of the prompt (below).
4. **At zero:** `EmptyState` "No possible duplicates" / "None of HDFC Savings's drafts match
   another draft or anything already in your books." The prompt is left out.

*Balance checks tab*:
1. **Summary:** "3 balance checks fail. The first is on 5 Sep, where the drafts' running
   balance is ₹10,000 away from the statement's." Figures in mono (`formatMoney` of the
   absolute difference).
2. **Grid:** the `draft-balance-assertions` report for this account, without the Account
   column. Its links (the account ledger to that date, the draft) stay.
3. **"Ask your coding agent to find out"**, as on Duplicates.
4. **At zero:** `EmptyState` "Every balance check passes" / "On every day the statement
   printed a balance, the drafts add up to it." When the drafts carry no balance check:
   "These drafts have no balance checks" / "Drafts from a statement carry the statement's
   balances. These don't, so there's nothing to compare."

**The prompts** (`src/review/agentPrompts.ts`, in the manner of the import prompts: what the
app was doing, the facts, what to do, what not to do, what to report back):
- **Both start with the account facts:** the name and ledger path, the account id, the
  draft count and dates, the last posted balance check (date and figure), and how to read
  the data: with `SAPPORTA_API_URL` and `SAPPORTA_API_TOKEN` (the agent token the import
  prompts describe), `GET /api/review/accounts/:accountId`,
  `GET /api/reports/duplicate-drafts?base_account_id=…`,
  `GET /api/reports/draft-balance-assertions?base_account_id=…`,
  `GET /api/tables/draft_transactions?filter[base_account_id][eq]=…&sort=date,id&limit=1000`
  and the account ledger report; or `data/sqlite.db`, read-only. Both say: don't change
  drafts, journals or balance checks without first saying exactly what and why; and the
  PII rule (shared with the import prompts) for anything written into the repository.
- **Duplicates prompt:** each possible duplicate as a line: date, direction and amount, the
  draft (id, narration, category), what it matched (the other draft's id and narration, or
  the journal and entry ids with the entry's comment and account), the match type and
  confidence. Asks, for each: are they one real transaction (which draft goes) or two (and
  why `packages/api/modules/reconciliation/journal-transaction-matcher.ts` matched them)?
  It names transfers between the user's own accounts as a common cause. Report a verdict
  per line and the change proposed.
- **Balance checks prompt:** each failing check as a line: date, draft id, running balance,
  the statement's balance, the difference. Explains how the check is computed
  (`packages/api/modules/reconciliation/running-balance.ts`: posted entries on the account,
  including ones posted from other accounts, come before drafts on the same date; only the
  last draft of each day carries the statement's balance). Asks the agent to find the first
  failing day, list the account's posted entries and drafts around it with the running
  balance, and find what explains the difference: a draft repeating an entry already
  posted from another account (a card payment or transfer), a missing or extra draft, an
  edited amount or date, or a gap between statements. Report the cause and the exact fix.
- **Size:** at most 50 lines of rows, then "and N more (read them from the API above)".

**Copy**
- Picker: title "Review". Description: "Pick an account to check its drafts and add them to
  your books. Each account is checked and added on its own." Empty state: "Nothing to
  review" / "Drafts appear here after you import statements." with an outline "Import
  statements" → `/import`.
- Frame: "All accounts"; tab labels "Overview", "Drafts", "Duplicates", "Balance checks".
- Overview, Duplicates, Balance checks and the prompts: as above.
- An account with no drafts (after posting, or a stale link): `EmptyState` "No drafts for
  HDFC Savings" / "Everything imported for this account is already in your books." with an
  outline "Import statements"; the tabs hide.
- Unknown account (404): "We couldn't find this account." with a ghost "All accounts".

**States**
- *Loading:* the picker keeps its card shape with row-height skeletons; the frame shows the
  header and tab bar as skeletons; tabs render their own loading (the grid's, or a
  skeleton line for a summary). No full-page spinner.
- *Error:* the backend error word for word where the content would be, with an outline "Try
  again".
- *Empty:* as in Copy.
- *Large volume:* the picker lists every account; the Drafts grid pages as Sapporta's grid
  does; the report grids scroll; the prompts cap their rows at 50.
- *Freshness:* the frame fetches the account summary on entry, on every tab change, and
  after posting. Category edits in the grid, and the Classify screen's results, show in the tab
  counts once you switch tab. The sidebar badge refreshes on route change, as in P0.

**Data and API changes**
- **Draft status module, `packages/api/app/draft-status.ts`**, the one source for what
  blocks posting. `loadDraftStatus(sqlite, scope)` returns, for every account with drafts:
  `drafts`, `uncategorised`, `first_date`, `last_date`, `balance_checks` (drafts carrying a
  statement balance), `closing` (the last of those: date and balance, or null), `failing`
  (rows of `failingDraftAssertionsSelect`) and `duplicates` (`findDuplicateDiagnostics`
  rows). It holds the queries `home.ts` runs today (the draft counts, the failing checks,
  `countDuplicates`). **Home, Review and the posting gate all read it**: `loadHomeSummary`
  takes its counts from it, and `post-drafts-to-journal.ts` blocks on its `uncategorised`,
  `duplicates` and `failing` for the account instead of its own three queries, so the
  Overview's ticks and the gate can't disagree. Counts are the report's rows, as in P1 (one
  draft matching twice counts twice).
- **Account names, `packages/api/app/account-names.ts`:** `importableAccounts` moves here
  from `home.ts`. A new `accountLabel(path, accountType, presets)` gives the display name and
  kind for any account: a single preset's name, else the path's last segment made readable;
  card when a preset says so, else when the account is a Liability. Home and Review use it.
- **New contract in `dbu6-shared`, `contracts/review.ts`** (auth as `/home`:
  `requireWorkflowAuth`, scope as reports):
  ```
  reviewAccount = { account_id, path, name, kind: "bank" | "card",
                    drafts, uncategorised, duplicates, failing_checks,
                    first_date: string | null, last_date: string | null }

  GET  /review/accounts
       → { accounts: reviewAccount[] }            // accounts with drafts, by name

  GET  /review/accounts/:accountId
       → { account: reviewAccount,                 // drafts may be 0
           checked_to: string | null, checked_balance: number | null,
           balance_checks: number,
           closing: { date, balance } | null,
           failing: [{ date, draft_id, running_balance, assertion, diff }],
           duplicates: [{ date, draft_id, other_draft_id, matched_journal_id,
                          matched_journal_entry_id, match_kind, match_type,
                          confidence, direction, amount, narration,
                          other_narration, draft_category, matched_category }],
           other_accounts: [{ account_id, name, drafts }] }
       404 when the account isn't in scope
  ```
- **Handler `packages/api/app/review.ts`**, registered in `app.ts`. Tests on a seeded
  in-memory ledger, as `home.test.ts` does: the list (only accounts with drafts, names from
  presets and without), the detail (counts, closing, failing, duplicates, other accounts,
  an account with no drafts, 404).
- **Report filter:** `reportsContract.duplicateDrafts` and `draftBalanceAssertions` take an
  optional `base_account_id` (`z.coerce.number().int().positive()`). With it, the rows are
  that account's and the account column is left out; without it, All tools' reports are
  unchanged.
- **Unchanged:** `POST /draft-transactions/post-to-journal` (Overview calls it),
  `/draft-transactions/classify` and `/classify-with-gpay` (the Classify screen still calls
  them). **No Sapporta changes.**
- **Frontend:** `reviewApi` in `src/api.ts`. `src/review/`: `ReviewAccounts.tsx` (picker),
  `ReviewAccount.tsx` (frame, tabs, `Outlet` with the summary and a `refresh` in context),
  `Overview.tsx`, `DraftsTab.tsx`, `DuplicatesTab.tsx`, `BalanceChecksTab.tsx`,
  `overview.ts` (a pure function from the summary to the verdict, the check rows, the
  waiting reason and the posting sentence) with tests, `agentPrompts.ts` with tests.
  `draft-transaction-quick-filter.ts` moves into `src/review/`.
- **Home (P1's "until P3" items):** `homeState`'s action for states 3–5 goes to
  `/review/:accountId` when exactly one account has drafts, else `/review`; state 5's "Add
  them to my books" goes there too, not to `/views/post-drafts`. State 3's inline links go,
  and `HomeCard.links` with them. On Home's account rows, the status chip of an account with
  drafts links to `/review/:accountId`.

**Components used:** dbu6 `Button` (default, outline, ghost; waiting), `StatusChip`,
`EmptyState`, `CopyPromptButton` (moved out of `import-statements/cards.tsx` into
`components/`, since three screens use it), Sapporta's `SchemaTableGridView`
(`rootRows.fixedFilters`, `actions`) and `eqCondition` (`@sapporta/shared/filter`),
`ReportResultBody` (`reports/shared.tsx`), the import formatting module (`plural`,
`formatBalance`, `formatDateRange`, `formatMoney`).

**Old screens retired or folded in**
- Deleted: `views/PostDrafts.tsx` (becomes Overview) and
  `views/draft-transactions/DraftTransactionsTable.tsx` (becomes the Drafts tab).
- Kept unchanged: `views/ReclassifyDrafts.tsx` and `views/AccountImportInputs.tsx`, at
  `/views/reclassify-drafts`, linked from the Drafts tab and All tools.
- Folded in: the Duplicate drafts and Draft balance assertions reports, per account, as tabs.
  The all-account reports stay on All tools and the reports index.
- All tools loses the "Post drafts" tile (its route redirects). P5 decides the rest of that
  page.
- Not built (from the handoff): the custom transaction list, merchant names, the command
  palette with "apply to all similar", the bulk bar, "Mark as duplicate", "Already
  checked", a per-row or per-selection categorise action. **Follow-ups:** "Remove this
  draft" and "Not a duplicate" buttons on the
  Duplicates tab (they need a delete mutation and somewhere to record the dismissal); a
  grouped balance diagnosis ("off by ₹10,000 since 5 Sep, likely cause …"); recording
  whether a category came from a rule, the AI or the user.

**Done criteria (page-specific, plus §4.9)**
- `loadDraftStatus` has tests. The posting handler, which has none today, gets a test for
  each of its three refusals and for a successful post, now reading the module. The `review`
  handler and the report filter have tests. `overview.ts` has a test for each verdict and
  for the waiting reason with one and with several unmet checks. The prompts have tests
  that the facts and the 50-line cap appear. `homeState`'s tests follow the new targets.
  `redirects.test.tsx` covers the new redirect and no longer the table one.
- In the browser with the seed (HDFC Savings has drafts, with a duplicate): `/review` goes
  straight to HDFC Savings; Overview lists what blocks; "See them in Drafts" opens Drafts
  filtered; the Drafts grid shows only this account, with no account chip; setting a
  category in the grid lowers the count after a tab switch; "Run the categoriser again"
  opens the Classify screen as it is today; Duplicates and Balance checks show only this
  account, and "Copy prompt" copies; after fixing, "Add N to my books" posts and the done
  state appears; `/views/post-drafts` lands on `/review`; `/tables/draft_transactions`
  shows the raw table. With drafts on a second account (import
  a parser fixture), the picker lists both and "All accounts" shows.
- No colon paths outside `title` attributes on the picker, the header and Overview (the
  grids keep their account columns).
- `pnpm typecheck`, `pnpm test`, `pnpm format:check`; screenshots at 1920 and 390 in
  `tmp/redesign/p3/` (picker, Overview blocked, Overview ready, after posting, Drafts,
  Duplicates, Balance checks, empty).

### P4 · Income & expenses (handoff: Report and Report-full): Status: Not started
- Summary and full detail: tabs or separate routes?
- Presets: does "This year" mean the Indian financial year (April–March)?
- Grouping by the first path segment.
- The monthly series.
- Reading the `GridDataset` vs. new JSON endpoints.
- A calendar for "Pick dates" (D5).
- Download format.
- The accountant's-view link.

### P5 · All tools (handoff: Advanced): Status: Not started
- Renamed labels, with their technical names still visible.
- Which reports are "everyday" (green marker) and which are "accounting" (grey).
- Search.
- Where freeform import, the checkpoint and settings go.

### P6 · Accounts (no handoff screen): Status: Not started
- The list and adding an account.
- The account tree (`parent_id`) vs. a focus on bank accounts and cards.
- Whether category names and hues are managed here.

### P7 · Other reports (no handoff screen): Status: Not started
- Which get plain-language treatment (Account history, What you own and owe, Month by month,
  Net worth) and which stay as grid reports in the restyled report frame.
- Presets replacing the Run button and bare date inputs everywhere.

### P8 · Tool screens (reclassify, render hledger, post drafts, journals, raw tables): Status: Not started
- For each: keep, restyle, or fold into Review or All tools.

### P9 · Framework screens (auth, profile, workspace settings, not found, boot): Status: Not started
- Theme only, unless we want a branded sign-in layout.
- If we do, apply the depth rule (D1): compare composing the sign-in forms in a dbu6 layout
  against adding a layout prop to Sapporta's auth pages. The forms hold real behaviour (auth
  calls, errors); `AuthFrame` is about 20 lines of markup.

---

## 12. Verification (applies to every step)

- **Screenshots:**
  - Compare after screenshots with the §6.7 baseline.
  - Take them at 1920px to match the baseline, plus 390px for mobile, with `pnpm seed` data.
  - Save them under `dbu6/tmp/redesign/<step>/` (naming in §0).
  - For routes not in the baseline, take a before screenshot there first.
- **dbu6:** `pnpm typecheck`, `pnpm test`, `pnpm format:check`.
- **Sapporta:** `pnpm typecheck`, `pnpm test`, and `pnpm check:module-index` when exports change.
- **Accessibility:**
  - text contrast at least 4.5:1;
  - every figure mono and tabular;
  - click targets at least 44px;
  - money in and out never shown by colour alone;
  - focus-visible rings present.
- **No personal data** in any fixture, test or screenshot you commit (dbu6 `AGENTS.md`).
  Screenshots stay outside git.
- **At the end of Step 6:** the full §4.9 definition of done.

---

## 13. Progress log

Newest first. Format: `YYYY-MM-DD · Step · what changed · deviations and follow-ups`.

- 2026-09-16 · Legibility review of P1–P3 · Five findings fixed at the owner's request, behaviour and copy
  unchanged except where noted.
  - **What blocks posting has one definition.** `postingBlocks(counts)` in dbu6-shared
    (`contracts/posting-blocks.ts`) lists the blocks in tab order, each marked problem or
    attention. The posting gate refuses on the first (same codes and order as before);
    Home's card and chips, the Review picker's chips, Overview's checks and waiting reason
    and the tab badges read it instead of comparing counts themselves. `draftCountsSchema`
    is the counts' one shape in `homeAccountSchema`, Home's totals and `reviewAccountSchema`;
    `draftCounts(status)` in `app/draft-status.ts` builds them (no more `?? 0`).
  - **Import errors are typed end to end.** `statementImportErrorSchema` (dbu6-shared
    `contracts/import-errors.ts`) has a variant per code; every `ApiImportError.toPayload()`
    returns one, and the auto and freeform import contracts use it instead of
    `.passthrough()`. The server now says what the screen used to guess from `hint`:
    `balance_mismatch.suspected_gap` and `statement_boundary_mismatch.reason`
    (`gap` | `same-statement-twice`, which also writes the hint). The Import screen parses
    the reply once (`views/import-statements/outcome.ts`, `readImportResponse`) into an
    `ImportFailure` union; the cards switch on typed fields, and each code's tone is a
    `Record` over the codes, so a new code without a tone won't compile.
  - **The Import screen's state is one union** (`choosing | importing | finished`) instead
    of `loading`, `result` and `error`.
  - **One account kind.** `AccountKind` (`bank` | `card`) in dbu6-shared
    (`contracts/account-kind.ts`) with `accountKindOf(is_credit_card)`,
    `accountKindOfType(account_type)` and `LEDGER_ACCOUNT_TYPE`. The importer's
    `"credit-card"`, `FreeformAccountKind` and `formatBalance`'s boolean are gone. Preset
    and wire fields keep `is_credit_card`.
  - **Screens load through TanStack Query** (owner's choice), keyed in `src/queries.ts`:
    Home, the Review picker, the account frame, the sidebar badge, every report
    (`useReportResult` now takes a key) and the freeform screen's account list. Queries
    refetch on mount (`staleTime: 0`) and don't retry a 4xx; the frame and the badge
    refetch on route change (`useRefetchOnNavigate`), as before. Posting invalidates every
    draft-status query.
  - **Smaller:** `format.ts` moved to `src/format.ts`, `PII_RULE` to
    `src/agent-prompt-rules.ts`; `accountPathName` in dbu6-shared replaces
    `readableSegment` and `categoryName`; `REVIEW_DRAFTS_ROUTE` is gone (`REVIEW_ROUTE`);
    the unused `applyCreditCardSignFlip` and its tests are deleted.
  - **Copy changes:** Home's ready card body is "The entries are ready for posting." (§11
    P1 updated). A reply the Import contract doesn't describe (an unknown code, a 500)
    gets its own card ("The import", no agent prompt, the raw reply in Technical
    details) instead of the generic card with the failed account's name.
  - **Verified:** `pnpm typecheck`, `pnpm format:check`, frontend tests (86), API tests
    (the four XLS parser tests still fail on the pip `xlwt` issue). Not verified in the
    browser: the dev app needed a sign-in.
  - **Follow-ups:** the sidebar badge still counts through the table API (owner: keep it
    for now). `ReclassifyDrafts.tsx` and `RenderDraftHledger.tsx` still load with their own
    effects; P8 rebuilds them.
- 2026-09-16 · Step 6, P3 · Review built as specified (§11 P3). Uncommitted at the time of writing.
  - **shared:** `contracts/review.ts` (`reviewContract.accounts` and `.account`, with the
    account, failing check, duplicate and detail schemas). `reportsContract.duplicateDrafts`
    and `draftBalanceAssertions` take an optional `base_account_id`.
  - **api:** `app/draft-status.ts` (`loadDraftStatus`, `findFailingChecks`,
    `findDraftDuplicates`, each narrowable to one account). `app/account-names.ts`
    (`importableAccounts`, moved from `home.ts`, and `accountLabel`). `app/review.ts`
    (`listReviewAccounts`, `loadReviewAccount`), mounted in `app.ts`. `home.ts` takes its
    counts from the status module. The posting handler's body is
    `postDraftsToJournal(ledger, accountId)` and refuses on the module's counts. Both draft
    reports read the module and leave the account column out when narrowed; the balance
    checks grid then carries the ledger link on its date. Tests: `draft-status.test.ts` (the
    status and both report filters), `account-names.test.ts`, `review.test.ts`,
    `post-drafts-to-journal.test.ts` (the three refusals, a missing account, a post), and
    the review routes in `app.test.ts`.
  - **frontend:** `reviewApi` and `apiErrorMessage` in `api.ts`. `src/review/` as §2.1 lists
    it, with tests for `overview-state.ts`, `agentPrompts.ts` and the frame
    (`ReviewAccount.test.tsx`: a refetch on tab change, a path that isn't a tab, an id that
    isn't one, a 404). `draft-transaction-quick-filter.ts` moved into `src/review/`; the
    quick filters write to the tab's URL. `CopyPromptButton`, `Disclosure` and `LoadError`
    moved into `components/`, shared by Import, freeform import, Home and Review.
    `format.ts` gained `formatShortDate` and `formatDaySpan` (tested). Home's card and its
    account chips point at the account's review, and state 3's report links are gone.
    Routes and redirects as specified; All tools lost "Post drafts"; `PostDrafts.tsx` and
    `DraftTransactionsTable.tsx` are deleted.
  - **Verified:** `pnpm typecheck`, `pnpm format:check`, frontend tests (84), API tests (249
    pass; the four XLS parser tests fail on the pip `xlwt` permission issue noted in P0). In
    the browser, a Playwright walk-through in the session scratchpad at 1920, each shot also
    at 390. It used a temporary presets file naming the seed's four statement accounts, and
    SQL on the dev database for what the seed lacks: a copy of one HDFC Savings draft (a
    possible duplicate, which also fails the 15 Sep balance check) and two categorised ICICI
    Amazon Pay drafts as a second account. Checked: Home's card and HDFC's chip link to
    `/review/1050`; `/review` goes straight to HDFC Savings; Overview lists the three blocks
    and the waiting reason; "See them in Drafts" opens the tab with an "Account is empty"
    chip, 3 records and no account chip; unfiltered, the grid shows HDFC's 23 only; "Run the
    categoriser again" opens Classify drafts; Duplicates and Balance checks show one row
    each without the account column, and "Copy prompt" puts the prompt on the clipboard;
    with the second account, the picker lists both by name and the back link shows; after
    fixing the drafts, Overview is ready with the posting sentence; a draft changed before
    pressing the button gives the server's 422 words and a refetched summary; posting shows
    "22 transactions added. HDFC Savings is checked to 15 Sep at ₹3,22,445.00." with "Review
    ICICI Amazon Pay" and Drafts 0; ICICI shows the no-balance-checks row and posts with
    "Import statements" next; `/review` then shows "Nothing to review"; SBI Savings shows
    "No drafts for SBI Savings" without tabs; an unknown account, `/review/abc`,
    `/views/post-drafts` and `/tables/draft_transactions` behave as specified; no colon paths
    on the picker, the header or Overview. The database was restored from a backup and the
    presets file put back afterwards. Screenshots in `tmp/redesign/p3/`: `picker`,
    `picker-empty`, `overview-blocked`, `overview-ready`, `overview-post-refused`,
    `overview-no-balance-checks`, `after-posting`, `after-posting-last`, `drafts`,
    `drafts-needs-category`, `duplicates`, `balance-checks`, `empty`, each also `-390`.
  - **Not verified in the browser:** setting a category in the grid, then seeing the count
    drop after a tab switch. The script typed into the category editor and pressed Enter,
    which the combobox ignores until an option is highlighted, so nothing saved; restoring
    the database then ended the script's session, and the walk-through wasn't signed in
    again. `ReviewAccount.test.tsx` covers the refetch on tab change; the grid's editing is
    Sapporta's, unchanged. The walk-through also found a bug, now fixed with a test: an
    unknown tab under an account with no drafts stayed put, since the empty state never
    rendered the redirect route. `ReviewAccount` now checks the path itself.
  - **Deviations:**
    - The pure Overview module is `overview-state.ts`, not `overview.ts`: on macOS's
      case-insensitive file system, `./Overview` resolved to `overview.ts` before
      `Overview.tsx`.
    - The account frame is its own layout rather than `Screen` (§2.1). Overview's column is
      760px, left-aligned under the header.
    - The Duplicates and Balance checks counts are a small mono badge, white on
      `--destructive`, not red text: red text on the active ink pill fails contrast.
    - Names aren't made possessive (as in P1): "None of the drafts for HDFC Savings match
      another draft or anything already in your books."
    - Money in sentences uses `formatBalance` (two decimals; "owed" for cards). Day spans
      read "1–15 Sep", with the year in the frame's subline.
    - Check rows carry a 26px marker (✓, !, or a dashed ring), like the handoff's balance
      strip medallion.
    - On the report tabs, "Copy prompt" sits under the "Ask your coding agent to find out"
      heading, and the prompt's text is in a collapsed "Preview the prompt". A report that
      fails to load shows `LoadError` with "Try again".
    - The posting gate still partitions the drafts for its typed plan, and throws if that
      disagrees with the status module (both are read in one synchronous pass).
    - `apiErrorMessage` reads an API error's body before its `Error` message, so Home and
      the report screens now show the server's words instead of "API error 4xx".
  - **Findings:** the seed has no possible duplicate or failing balance check (only three
    uncategorised drafts), so the done criteria's "with a duplicate" needs setup. A copied
    draft on a day whose balance check sorts before it (by id) fails only the next check.
    Restoring the dev database from a backup restores its sessions too, signing out any
    session made since. The grid's category editor is a Base UI combobox: typing filters,
    and Enter applies only a highlighted option.
  - **Follow-ups:** seed a possible duplicate and a second account with drafts, so Review's
    states need no SQL; "Remove this draft" and "Not a duplicate" on the Duplicates tab
    (from the spec); the sidebar badge could read the draft status; in the Drafts tab,
    Sapporta's grid header starts 20px from the edge while the frame's header starts at
    56px; `plural`, `joinNames` and the date formatters serve Home and Review from the import
    formatting module.

- 2026-09-15 · Step 6, P2 · Import statements built as specified (§11 P2). Uncommitted at the time of writing.
  - **Shell:** dbu6's `NavigationItem` has `shortLabel`; the bottom bar prints it and keeps
    the full label as the accessible name; Import statements sets "Import". Two
    `AppShell.test.tsx` cases.
  - **Import page** (`views/AutoImportStatements.tsx`): the shared `Screen` frame; the
    dropzone, file rows, type tiles and Google Pay row in `import-statements/files.tsx`; no
    extension filter; the import button with its waiting reason and importing note; the done
    state ("Review N transactions" → `/review`, "Import more statements"); the failure state
    keeps the dropzone, the list and the import button. `cards.tsx` has one `ResultsCard`
    (a row per account) and the new `ProblemCard`; `AccountCard`, the tiles and the hledger
    disclosure are gone.
  - **Describe modules:** `describeProblems` gives every problem a tone through one table
    (`problemTone`: attention for `auto_import_files_unresolved`,
    `opening_balance_unavailable`, `closing_balance_unavailable`,
    `statement_part_unjoinable` and 403; destructive for everything else), adds "Import them
    freeform instead" to the unrecognised card, and shows the difference for
    `segment_balance_mismatch`. `describeBatch` returns a tone and the "what next" sentence;
    `describeFileStatus` takes the failed account's tone. `describeGroup` returns the row's
    chip, counts sentence, balances line and Google Pay line. Every "Process" is "Import".
    `REVIEW_DRAFTS_ROUTE` is `/review`; `agentPrompts.ts` names `/import`. `format.ts` gained
    `formatFileSize` and `fileTypeLabel` (tested) and lost the unused `formatSigned`.
  - **Freeform import:** on `Screen`; `components/ui/radio-group.tsx` (segmented) and
    `components/ui/select.tsx` on Base UI replace the native radios and select.
  - **Verified:** `pnpm typecheck`, `pnpm format:check`, frontend tests (66, including a
    test per tone group). In the browser (a Playwright walk-through in the session
    scratchpad, at 1920 and 390), with a temporary presets file and two temporary accounts
    fed by copies of the stanc-bank-csv and hdfc-cc-csv fixtures, all restored or deleted
    afterwards: a successful import with a Takeout added through its row ("Named 1 UPI
    payment from Google Pay"; "Review 8 transactions" opens `/review`); the same files again
    (nothing new, one primary); an `.html` dropped on the zone (attention, the freeform
    button, "Remove this file and import the rest" then a retry); a gap between two
    statements of one account (destructive, figures shown); a partial import (1920); the
    bottom bar reads "Import" untruncated; no visible native file input, radio or select on
    either screen; freeform still builds the prompt for the chosen account, by mouse and
    keyboard. Screenshots in `tmp/redesign/p2/`: `import-empty`, `import-files-added`,
    `import-importing`, `import-done`, `import-done-details`, `import-nothing-new`,
    `import-problem-attention`, `import-problem-destructive`, `import-problem-partial`,
    `freeform`, `freeform-select-open`, `freeform-prompt`, each also `-390` (except
    importing and partial).
  - **Deviations:** the frame is a shared `components/screen.tsx`, and Home moved onto it
    unchanged. The "N statements" heading sits above the file card, as in the handoff; the
    dropzone keeps the handoff's ↑ tile. A chosen Takeout row adds a quiet "Names from Google
    Pay" line so it doesn't read as a statement. "Clear all" clears the statements, not the
    Takeout. Two tokens in `app.css` section 2, `--dropzone-bg` (#FCFCFC) and `--tile-bg`
    (#EFF1F1), since hex stays out of components. The nothing-new sentence reads "imported
    for" (was "processed for"). The Details breakdown says "Already waiting in Review" (was
    "in Drafts"). Fact values gained a `face` so sentences aren't set in mono. The problem
    tones use `StatusChip`'s names (`problem` is destructive). The balances line shows only
    the closing figure when the statement prints no opening (the stanc CSV). The Select's
    list starts at the trigger's left edge and is capped at the available width, so long
    account paths wrap at 390px.
  - **Findings:** the saved parsers check their own totals and running balances, so editing
    one amount in a fixture gets the file rejected as unrecognised rather than reaching the
    importer's `balance_mismatch`; the destructive tone was verified with
    `statement_boundary_mismatch`. An import categorises new rows through the configured
    Nuabase LLM, which is most of its time. The shell scrolls an inner region, so
    Playwright's `fullPage` screenshots stop at the viewport (the script sizes the viewport
    to the content first). Playwright's `:visible` counts Base UI's clipped 1px form inputs.
    In a full `pnpm test`, the stanc-bank-csv and stanc-cc parser tests can hit vitest's 10s
    timeout under load; both pass on their own. The two XLS parser tests still fail here
    (pip, see P0).
  - **Follow-ups:** a file's status line repeats the account when the statement prints no
    institution ("Sample Savings statement … → Sample Savings"); the ▸ ▾ glyphs render small
    in Schibsted Grotesk; a file dropped outside the zone still opens in the browser
    (as before); `Stat` lives in `describeGroup.ts` but serves both describe modules; the
    Import page has no component test for its state changes (the walk-through covers them).
- 2026-09-15 · Step 6, P3 · Spec agreed with the owner (§11 P3); nothing built.
  - **Decided:** import stays as P2 specifies. The owner first heard, and rejected, an idea
    to limit each import to one account. Review starts by picking one account that has
    drafts; `/review` skips the picker when only one account has any. Each account has
    an Overview (what blocks posting, or "safe to post", and the only post button) and
    tabs for Drafts, Duplicates and Balance checks. The tabs are links with counts, not a
    left rail, since the grid needs the width. Render hledger stays on All tools. The
    Duplicates and Balance checks tabs are read-only reports filtered to the account, each
    with its own copy-prompt for the coding agent. The sidebar label stays "Review"; the
    button reads "Add N to my books". Post drafts and the draft table's screen fold in and
    are deleted.
  - **Revised the same day:** no Sapporta changes (a grid title prop was dropped, so the
    Drafts tab keeps Sapporta's "Draft Transactions" header). Categorising stays as it is:
    no "Categorise N" action or `set-category` endpoint, and no new categorise endpoint.
    "Run the categoriser again" links to the unchanged Classify drafts screen, custom
    mapping files text field included. The column relabelling and the renamed quick
    filters were dropped too.
  - **Filled in while writing, not asked separately:** no confirmation before posting (a
    sentence says what posting does); `/tables/draft_transactions` stops redirecting to
    `/review` (reverses P0's row), so the reports' "Open draft transaction" links land on
    the row; one draft status module feeds Home, Review and the posting gate; Home's
    status chips link to the account's review; state 3's inline report links go.
  - **Found:** Sapporta's grid already has `rootRows.fixedFilters`: always applied, never
    shown as a chip. The grid doesn't use React Query, so an outside change reloads
    through `session.reloadRows()` or `reloadTGridRows`. `SchemaTableGridView` always
    titles its header with the table label and names the browser tab
    (`PageHeader.documentTitle` exists but isn't passed through). `ReportGridDataset`
    already renders without the report frame (`ReportResultBody`). The posting handler
    has no tests. Reading the matcher, a card payment already posted from the bank side isn't flagged as a
    duplicate of the card's "payment received" draft: keyed journals skip the payment
    match. It shows up only as failing balance checks, which the balance-checks prompt
    names as a likely cause.
  - **Follow-ups:** "Remove this draft" and "Not a duplicate" on the Duplicates tab; a
    grouped balance diagnosis ("off by ₹10,000 since 5 Sep, likely cause …"); recording
    whether a category came from a rule, the AI or the user; the handoff's category
    palette, merchant names and bulk bar.

- 2026-09-15 · Step 6, P2 · Spec agreed with the owner (§11 P2); nothing built.
  - **Decided:** keep today's one-request import. The handoff's Import screen is a throwaway
    idea, so there is no check-before-import endpoint, no "Change" and no per-file matching
    before import. After a successful import the page stays in a done state ("Review N
    transactions" primary, "Import more statements"), rather than jumping to Review. One
    results card with a row per account, without the tiles, the hledger journal or a
    needs-a-category count. Problem cards keep their content: destructive when the numbers
    don't add up, attention when something needs setting up. The Google Pay Takeout gets
    its own row. The dropzone doesn't filter by extension, and an `.html` dropped there is
    treated like any other statement, not routed to the Takeout row. Freeform import stays
    a separate screen, linked from Import and restyled lightly. The bottom bar shows
    "Import" through a `shortLabel`. No API changes.
  - **Filled in while writing, not asked separately:** the tones of the permission (attention),
    connection and unexpected-error (destructive) cards; the Google Pay row and remove
    buttons hide in the done state.
  - **Found:** each card's "Review drafts" link points at `/views/reclassify-drafts` (the
    Classify tool), not Review. `agentPrompts.ts` still names `/views/import-statements`.
    Recognition is cheap: each saved parser ran in 0.1–0.3s on its fixture; categorisation
    (rules, then the LLM) is the slow part of an import. `AccountImportInputs.tsx` is used
    only by `ReclassifyDrafts.tsx` (P3/P8), not by Import.

- 2026-09-15 · Step 6, P1 · Home built as specified (§11 P1). Uncommitted at the time of writing.
  - **shared:** `contracts/home.ts` (`homeContract.summary`, `GET /home`, the account and
    totals schemas). **api:** `app/home.ts` (`loadHomeSummary`, `importableAccounts`) with
    `home.test.ts` on an in-memory ledger (checkpoints, draft counts, a failing check, a
    duplicate pair, an account no preset names, a preset with no account). **frontend:**
    `homeApi`; `home/state.ts` (`homeState`) with a test per state plus the one-problem and
    unlisted-drafts cases; `home/Home.tsx`; `NextStepCard` takes an optional `count` and a
    `ReactNode` body and wraps at narrow widths; `Welcome.tsx` deleted.
  - **Verified:** `pnpm typecheck` (all three packages), frontend `pnpm test` (54), the
    handler test, `pnpm format:check`. In the browser with the seed: state 4 (3 need a
    category, HDFC Savings "22 drafts waiting", the other three "Checked" with their
    checkpoints and balances); then, by editing the demo drafts and re-seeding between
    each, states 3, 5 and 6, and state 1 with an empty presets file. Screenshots at 1920
    and 390 in `tmp/redesign/p1/` (`home-seed`, `home-problems`, `home-ready`,
    `home-up-to-date`, `home-no-accounts`).
  - **Deviations:** the card body for state 3 renders its links as short sentences after
    the text ("See the balance checks."). Bodies say "the drafts for HDFC Savings" rather
    than a possessive, which reads badly with several names. The header honours
    `--sap-page-header-inset` so the drawer toggle clears the date at 390px. `duplicates`
    counts the report's rows, so one duplicated draft can count more than once (3 in the
    demo, where it also matched posted entries).
  - **Findings:** the dev install's `import-presets.json` names "Example Bank" and
    "Example Credit Card", accounts the seed never creates, so on this machine Home shows
    them as "Account missing" unless the file is changed; the screenshots used a
    temporary presets file matching the seed, restored afterwards. `pnpm seed` reads
    `SAPPORTA_API_URL`, which only mise sets, so outside a mise shell it aims at port 3000;
    run it as `mise exec -- pnpm seed` or export the variable. Re-running the seed within
    a minute fails at sign-in (rate limited), as does the screenshot script's login. In
    dev, React StrictMode fetches `/home` twice; production makes one request.
  - **Follow-ups:** the seed could write presets for the demo accounts, or P6 could move
    presets into the app; the sidebar badge could read `totals.uncategorised` from `/home`
    instead of its own request; `plural`/`joinNames` now serve Home from the import
    formatting module and may deserve a shared home.
- 2026-09-15 · Step 6, P1 · Spec agreed with the owner (§11 P1); nothing built.
  - **Decided:** no "month so far" card (figures belong to the reports); Home shows the
    reconciled situation, which accounts have drafts, and what blocks posting, in plain
    words. "Your accounts" is the unique set of base accounts across the import presets
    (first answered as a path-prefix rule, then revised: users need not keep banks under
    `assets:bank`). Rows show facts only, no staleness guess. Problems (failing balance
    checks, duplicates) outrank uncategorised drafts in the next-step order. One
    `GET /home` contract. Date eyebrow and greeting, no ProgressSteps. "Add an account"
    opens `/accounts` until P6.
  - **Found:** import presets are a JSON file on disk read by one GET endpoint, not
    editable in the app; the month figures in every report come from posted journals only,
    so a mid-month card would have read near-empty; `loadLastReconciled` is already an
    exported query the handler can reuse.
- 2026-09-15 · Step 6, P0 · Built as specified (§11 P0). Uncommitted at the time of writing.
  - **dbu6:** `App.tsx` carries the six-item navigation and the new routes; `redirects.tsx`
    holds the retired-path table (search and hash preserved) with a test; `shell/` lost the
    rail, the Browse picker and the overflow logic, and `Navigation` is `{ everyday, more }`;
    `reports/registry.tsx` gained the everyday and accounting cards and lost
    `defaultReportPath`; `reports/ReportsIndex.tsx` is the `/reports` page;
    `components/link-card.tsx` is the card link shared with All tools; All tools gained
    "Import freeform transactions" and now calls itself All tools; Welcome and freeform
    import link to the new paths; the draft grid writes its filters to `/review`.
  - **Verified:** `pnpm typecheck`, frontend `pnpm test` (46, including 7 redirect cases
    and the bottom-bar and badge-on-Review cases), `pnpm format:check`. In the browser:
    signed-out `/` reaches sign-in; each retired path redirects with its query string; All
    tools links every old destination; the index shows 14 cards. Screenshots in
    `tmp/redesign/p0/` at 1920 and 390, plus the drawer.
  - **Deviations:** `navigationItems` was dropped rather than kept (nothing used it). The
    unknown-report fallback (`/reports/:reportName` → `/reports`) drops the query string,
    since it belongs to no report. The `/tools` page's eyebrow and tab title say "All tools"
    (a two-word change ahead of P5).
  - **Findings:** Sapporta's `dbu6-redesign` is merged into `main` and the checkout sits on
    `main` (§2.3 updated). dbu6's `pnpm test` fails two API parser tests in this sandbox
    (`hdfc-bank-xls-parser`, `federal-bank-xls-parser`: pip cannot write `xlwt` into
    `/Library/Python/3.9/site-packages`); unrelated to P0.
  - **Follow-ups:** at 390px the bottom bar truncates "Import statements" to "Import
    stat…" (five labels in 390px); P2 may pick a shorter label or the bar may drop labels.
    Sapporta's table header on `/accounts` renders a self-link to `/tables/accounts`
    (`aria-current`), which works through the redirect; a `TablePage` prop for the mounted
    path would remove the hop. The two API parser tests need a writable Python
    environment (a venv) to run here.
- 2026-09-15 · Step 6, P0 · Spec agreed with the owner (§11 P0); nothing built.
  - **Decided:** no Help & support item (5 + 1); `/` is the protected Home and the public
    `/welcome` goes; `/reports` is an index of all twelve reports grouped everyday /
    accounting; the new everyday routes render today's screens until their pages are
    built; tool URLs under `/views`, `/tables` and `/reports/<id>` stay; the rail and
    picker go and the bottom bar shows the five everyday items; icons stay everywhere.
  - **Found:** `/welcome` renders without a session today; `/reports/:unknown` lands on
    trial balance; freeform import is on no screen but the sidebar, so All tools must
    gain it; the handoff's twelve report cards count two reports twice and omit the
    checkpoint and draft balance assertions.
- 2026-09-15 · Step 5 · dbu6's components and page cleanup.
  - **5b:** `src/components/` holds the category module, `ui/button.tsx`, `Amount`,
    `CategoryLabel`/`NeedsCategory`, `StatusChip`, `ProgressSteps`, `NextStepCard`,
    `EmptyState`, `TransactionRow`, with tests for amounts and categories. Two tokens added
    to `app.css`: `--sidebar-avatar` (Step 3) and `--category-bg` (the pill fill, #F5F6F6).
  - **5a:** the twelve files in §10 moved onto the tokens and dbu6's `Button`; the done
    grep is empty. "Render as hledger" is a header action. Native selects, radios, file
    inputs and the raw table stay until Step 6.
  - **Also fixed:** `/setup/accounts/new` rendered blank, before this work too: Sapporta's
    record form calls `useQueryClient()` and dbu6's `main.tsx`, older than the scaffold
    template, never mounted a `QueryClientProvider`. `src/query-client.ts` and the provider
    are now in place (and `@tanstack/react-query` is deduped like React). This was the "No
    QueryClient set" console error logged in Step 2.
  - Screenshots in `tmp/redesign/step-5/` (every route, 1920 and 390).
  - **Follow-ups:** the amount sizes in `Amount` (18/20/33px) and the row sizes in
    `TransactionRow` (15/16.5px) are literal px from the handoff, not tiers; fine until a
    second component needs them. Sapporta's `SchemaTableGridView` has no `columnSizing`
    pass-through, so `/tables/*` still use the 112px numeric track.
- 2026-09-15 · Step 4 · Sapporta's surfaces on the tiers (three commits on `dbu6-redesign`).
  - **ui:** every primitive and the combobox on `h-sap-ctl`/`text-sap-*`/`rounded-*`;
    `--sap-shadow-elevated` → `shadow-sap-elevated` for floating layers (D7);
    `bg-sap-kbd-inverted`; no shadows on in-flow surfaces.
  - **grid:** `--sap-grid-*` reach; `columnSizing.minWidths`; popups on the elevation token;
    `data-grid-part` hooks.
  - **frontend:** table chrome, filters, forms, report chrome, auth/profile/settings, boot
    loader and the shell components on the tiers; `TGrid`/`ReportGridDataset` take
    `columnSizing`; the narrow table header keeps the inset contract.
  - **dbu6:** `app.css` section 6 and the elevation value; `reports/shared.tsx` passes
    `{ numeric: 128, timestamp: 176 }`. Screenshots in `tmp/redesign/step-4/` (filter
    popover, cell editor, the hledger dialog, the record detail sheet at 390).
  - **Deviations:** `SapportaMark` keeps `rounded-[6px]` (a 17px mark). The tooltip lost its
    border (a light hairline on an inverted fill). The checkbox box stays 16px and the
    switch 20×36px: no tier names them. `AccountMenu`'s panel took `rounded-lg`.
  - **Follow-ups:**
    - Inside the cards presentation, `table-card.css` redefines `--text-sap-data` as the
      body size, so the card label mapped to `sap-data` reads at body size there.
    - `ReportGridDataset.css`'s nested-indent rule (0,1,0) loses to the preset's
      `.presetGrid[data-grid-depth]` (0,2,0), so reports indent 58/46px, not 18px. Left as
      it was.
    - `.levelStatusRetry` stays 24px inside a 29px band; a 44px scale may want the band
      taller.
    - The 14 pre-existing typecheck errors in Sapporta's grid test files remain.
- 2026-09-15 · Step 3 · dbu6 owns its app shell.
  - **Sapporta** (`dbu6-redesign`, one commit): `SidebarRegion`/`SidebarDrawer` size to
    content; `Toaster` exported from the shell subpath; `PageHeader.css` replaced by the
    `--sap-page-header-inset` contract (`PageHeader` and the narrow `TableGridHeader`);
    header title and subtitle on the `sap-body`/`sap-menu` tiers; `AccountMenu` custom
    trigger reports the real `aria-expanded`.
  - **dbu6**: `src/shell/{AppShell,Sidebar,navigation,navigation-counts}.tsx|ts` and
    `AppShell.test.tsx`; `SapportaApp.tsx` renders dbu6's shell and the Toaster;
    `App.tsx` marks "Draft entries" with the badge; `--sidebar-avatar` token. Screenshots
    in `tmp/redesign/step-3/`.
  - **Deviations:**
    - The Toaster lives in `SapportaApp.tsx` above `BootLoader`, not in the shell. With it
      in the shell (as in Sapporta's `AppShell`), the time zone toast on
      `/workspace/settings` never showed: the store resets the schema, the gate remounts
      the shell, and the toast finds no outlet. Verified in the browser both ways.
    - Compact items (rail, bottom bar) show a dot instead of the count.
    - The navigation picker panel uses `shadow-lg` until Step 4's elevation token exists.
  - **vitest in dbu6:** `vite.config.ts` now carries a `test` block. Sapporta's tree is
    transformed by Vite (`server.deps.inline`) so React resolves to dbu6's copy, and
    `lucide-react` and `use-sync-external-store` (CommonJS, whose `require("react")`
    bypasses the aliases) are aliased and deduped to dbu6's copies. dbu6 depends on
    `lucide-react` 1.21; Sapporta resolves the same alias, so one copy serves both.
  - **Follow-ups:**
    - Sapporta's own `AppShell` renders its Toaster under `BootLoader` in generated apps
      (`SapportaApp.tsx` template), so the time zone and workspace-switch toasts are lost
      there too. Move the Toaster into the template above the gate, or have `BootLoader`
      keep the shell mounted.
    - `richColors` toasts use sonner's own green and red, not the 2a tokens.
- 2026-09-15 · Step 2 · Foundation done in both repos.
  - **Sapporta** (`dbu6-redesign`, three commits): `cn` built on `extendTailwindMerge` with
    the `sap-*` scales plus `extendCn` for apps; `--border`/`--color-border` and a layered
    `border-color` base rule; `--accent` → `--sap-row-hover`; `--sap-numeric-negative`
    (grid `NumericCell`, `ReportSummaryStats`); `--sap-radius-*` behind the `--radius*`
    aliases; the undefined tokens replaced; the editable focus-ring rule raised to two
    classes; theme store split into `useDocumentTheme()` (called by `AppShell`) and
    `forceMode()`. Tests added for `cn` and the theme store. Changesets added.
  - **dbu6**: Google Fonts link; `app.css` sections 1–4; `main.tsx` registers the type
    scale with `extendCn` and forces light. Contrast checked (lowest 5.4:1). A dark-mode OS
    was confirmed to get the light palette. Screenshots in `tmp/redesign/step-2/`.
  - **Deviations:** the shadows are declared only in `@theme inline` (not also in `:root`),
    since a `:root` copy of the same name would self-reference. `ReportSummaryStats`'
    negative tone also moved to the numeric token (it shows figures). The dark stopgap was
    skipped because the Sapporta fix landed in the same step.
  - **Follow-ups:**
    - Sapporta `pnpm typecheck` already failed on `main` with 14 errors in three grid test
      files (`table-grid-pager-boundary.test.ts`, `tgrid-session.test.ts`, `TGrid.test.ts`:
      "Expected 2 arguments, but got 1"). `pnpm test` passes. Not touched.
    - Every dbu6 page logs "No QueryClient set, use QueryClientProvider to set one" in the
      browser console. Sapporta's `table/query` uses React Query; nothing renders a
      provider. Pre-existing; pages still render.
    - `--sap-selection` equals `--sap-row-hover` (`#F8F9F9`), as the handoff specifies for
      selected rows. Editable grids show a focus ring, so cell focus is still visible; check
      selected-row visibility in Step 4.
    - Screenshot tooling: `node shoot.mjs <out-dir>` (a Playwright script kept in the
      session scratchpad, not in the repo) signs in as the demo user and captures the §6.7
      routes plus the Sapporta screens at 1920 and 390. Worth adding to `scripts/` if more
      steps need it.

- 2026-09-15 · Plan · Applied the depth rule with the owner.
  - **Decided:** D1 (the rule), D4 (dbu6 owns its app shell on Sapporta's behaviour primitives)
    and the Button part of D5.
  - **Added:** §6.8, the shell depth analysis, including three behaviour leaks and
    `--sap-active-nav-bg` being used for identity tiles.
  - **Step 3** is now mostly dbu6 work; its Sapporta tasks shrink to width, Toaster, header
    inset and title size.
  - **Step 4:** fixed values map onto existing tiers; primitives get token fixes only; no new
    primitives, variants, `hideClose`, `PopoverAnchor` or `AuthFrame` slot.
  - **Step 5b:** builds dbu6's Button.
  - **Proposed, not yet discussed:** generic primitives live in dbu6 (D5); no Sapporta
    attention token (D6).

- 2026-09-15 · Plan · Pointed screenshot references at the owner's baseline folder (§6.7).
  Marked the before-screenshot task done.
- 2026-09-15 · Plan · Made this file self-contained: added background, codebase guide, design
  spec, decisions status, and per-step goals, prerequisites, scope and done criteria.
- 2026-09-14 · Step 1 · Audit completed (§6). No code changed.
