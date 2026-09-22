# Writing a report

For a coding agent adding a report to a dbu6 project. A report is code in the
project's `reports/` folder: a route that computes it and a React screen that
shows it, written the way dbu6's own reports are. dbu6 finds the folder; there
is nothing to register.

```
reports/<id>/
  contract.ts   the route's query and response shape
  api.ts        default-exports a TsRestApi holding the route
  api.test.ts   a node:test test of the function behind the route
  Screen.tsx    the React screen
  report.ts     default-exports { id, label, description, Component }
```

One complete report, `spending-by-weekday`, is printed in full at the end of
this guide. Copy its shape.

## Rules

- Write only inside this project. Never edit anything under `node_modules`;
  `dbu6 upgrade` replaces it.
- Import only from `"dbu6/server"` and `"dbu6/frontend"`. They are dbu6's
  promised surface and carry forward across upgrades. The project has no other
  dependency, so import React, the router and the query hooks from
  `"dbu6/frontend"` too (`useState`, `Link`, `useQuery`, …), not from `"react"`.
- A report reads the books and never changes them. Read only through
  `reportLedger(c)`; do not open `data/sqlite.db` yourself.
- No real names, account numbers or amounts in tests. Use round amounts and
  `sample` / `NOPII` text (`dbu6 docs parsers`, "No Real Data In Fixtures And
  Tests").
- Import sibling files by their real name, extension included
  (`"./contract.ts"`, `"./Screen.tsx"`), and mark type-only imports with
  `type`. Node runs `api.ts` as it is, stripping the types; the project's
  `tsconfig.json` makes `dbu6 check` reject what Node could not run (enums,
  namespaces, constructor parameter properties).
- The `<id>` is the folder name, the `id` in `report.ts`, and by convention the
  last segment of the route's path. It must not be an id dbu6 already uses
  (the Reports page lists them; a clash stops the app with a message naming
  it).

## contract.ts

Declares the route with `initContract`, `z` and, for a grid report,
`gridDatasetSchema`, all from `"dbu6/server"`. The path is under `/reports/`
and does not repeat `/api`. Both `api.ts` and `Screen.tsx` import this file.

`contract.ts` is the only file on the screen's side that may import
`"dbu6/server"`. In the browser that specifier holds only the contract
helpers (`initContract`, `z`, `gridDatasetSchema`, `errorBodySchema` and the
dataset types); the build fails, naming the import, if a file the screen
reaches asks it for anything else.

## api.ts

```ts
const api = new TsRestApi<SapportaEnv>();
api.register("myReport", myContract.myReport, ({ c, request }) => ({
  status: 200,
  body: myReport(reportLedger(c, "my-report"), { ...request.query }),
}));
export default api;
```

Keep the route to that: turn the request into the input of one exported
function that takes the ledger and returns the body. That function is what
the test calls.

`reportLedger(c, "<id>")` answers 403 unless the signed-in user may read
reports, and returns a `ReportLedger`:

- `ledger.all<Row>(sql, params)` returns every row, `ledger.one<Row>(sql, params)`
  the first or `null`.
- The SQL reads four relations that hold only the signed-in user's rows:
  `scoped_accounts`, `scoped_journals`, `scoped_journal_entries` and
  `scoped_draft_transactions`. Never name the bare tables: they hold everyone's
  rows. Your SQL is placed after a `WITH` clause that defines those relations,
  so write a plain `SELECT`, or start with a comma to add CTEs of your own
  (`, monthly AS (SELECT …) SELECT … FROM monthly`).
- Bind values by name (`@fromDate`) and pass them in `params`. Do not build SQL
  from request values.
- A statement that writes is refused before it runs.

The ledger, briefly (`dbu6 docs books` has the rest): an account has `id`,
`name`, `parent_id` and `account_type` (`Asset`, `Liability`, `Equity`,
`Revenue`, `Expense`). A journal has `id`, `date` (`YYYY-MM-DD`) and
`description`. A journal entry has `journal_id`, `account_id`, `debit` and
`credit`. Spending is `debit - credit` on Expense accounts, income is
`credit - debit` on Revenue accounts, and an Asset's balance is
`debit - credit`. The account hierarchy comes from `parent_id` only, never
from the name, and entries can sit on a parent as well as on its children.
Drafts (`scoped_draft_transactions`) are imports not yet posted; a report
about the books leaves them out.

Helpers from `"dbu6/server"`:

- Columns: `textColumn`, `dateColumn`, `moneyColumn`, `percentColumn`,
  `hiddenIdColumn(id, label)`. Each takes `(id, label, options)`; `width` is
  in characters.
- `flatResult(name, label, { <level>: columns }, rows, { rowKey, footerRows })`
  builds a one-level `GridDataset`. `footerRow` and `sum` help with totals.
- Links: `accountLedgerLink({ account_id: "<column>" })` on a column opens the
  account's ledger; `openRecordLink(table, "<column>", label)` opens a record.
- Income and spending: `loadAccountAmounts(ledger, { types, fromDate, toDate })`
  gives each account's own amount in a period, and `loadMonthlyAmounts` the
  monthly totals.
- The account tree: `accountTree(accounts)` totals every node from
  `parent_id`; `accountTreeLevel` and `accountTreeNodes` turn it into one tree
  level of a grid, the way Expense Breakdown shows it.

A response that is not a grid is fine: declare your own zod schema in the
contract and draw it yourself in the screen.

## api.test.ts

`openTestLedger()` from `"dbu6/server"` is dbu6's schema in an in-memory
database with `addAccount`, `addJournal` and the `ledger` to pass to your
function. Assert on the figures, and parse the result with the contract's
response schema. Run it with `node --test reports/<id>/api.test.ts`;
`dbu6 check` runs every report's tests.

## Screen.tsx

Any React component. For a grid report use the blocks dbu6's own reports use,
all from `"dbu6/frontend"`:

- `reportClient(contract)` is a typed client for your contract:
  `client.myReport({ query })` resolves to the 200 body and throws otherwise.
- `useReportResult(queryKey, () => client.myReport({ query }))` runs it when
  the screen opens and returns `{ result, error, loading, run }`.
- `ReportScreenFrame`, `ReportToolbar`, `ReportRunButton` and
  `ReportResultBody` are the frame, the toolbar, Run and the grid.
- `useReportPeriod()` with `ReportPeriodField` keeps a period in the URL and
  gives `dates` (`{ from_date?, to_date? }`); `DateInput` with `today()` is a
  single date. Keep every input in the URL (`useSearchParams`), so a report
  can be linked to and reloaded.
- Formatters (`formatMoney`, `formatDate`, `formatMonth`, …), `Amount`,
  `accountLedgerHref` and `accountLedgerRow` for links into the account
  ledger, and `Screen`, `EmptyState`, `LoadError`, `Button`, `Select`,
  `ToggleGroup` for a screen that is not a grid.

Style with Tailwind classes; dbu6's theme tokens work (`text-row`,
`text-ink-meta`, `border-sap-border`, `bg-card`). Size a control with
`h-sap-ctl` and a row with `min-h-sap-row`, not in pixels: they are 44px and
48px on a touch screen, and 32px and 34px with a mouse. Classes are picked up
from files under `reports/` and from `frontend.tsx`, so keep a screen's
components inside its report folder.

## report.ts

Default-exports a `ReportDefinition`: `id`, `label`, `description` and
`Component`. It is listed on the Reports page under "Your reports" and opens
at `/reports/<id>`.

## See it work

1. `dbu6 check` typechecks the project, runs the report's tests and builds
   the frontend.
2. Restart `dbu6 dev` (or `dbu6 start`): routes are mounted at startup. A
   route that collides with an existing one stops startup with a message
   naming the file. Screens hot-update under `dbu6 dev` without a restart.
3. Open Reports. The route is also in the app's OpenAPI document, and can be
   called as `GET /api/reports/<id>` with an agent access token
   (`dbu6 docs books`).

## The worked report
