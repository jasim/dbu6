# @dbu6/app

## 0.4.0

### Minor Changes

- 7e00e61: `GET /reports/income-expenses` no longer returns `first_month`. The page
  stopped reading it when its month menus moved to `/reports/books-span`. The
  Overview still returns its own `first_month`: the first month with any
  income or spending, which its averages start from.
- d593555: dbu6 now opens on Overview: one month's income, spending and savings beside
  the usual month and the difference, the largest spending categories adding up
  to the month's spending, net worth with where it sits, the last twelve months
  against the average spending, and each bank and card's balance with the date
  its books are complete until. It starts on the latest month every account
  covers and names the accounts holding it there; `[` and `]` step the month,
  and a category opens its month-by-month chart or its entries. Until anything is
  posted it shows the first run's card instead, so a new user still starts with
  setup. `GET /api/overview` returns the same figures, or `{"posted": false}`
  until anything beyond the opening balances is posted.

  What was Home is now Update, at `/update`: each account, how far it is
  imported and what waits on it. The sidebar groups Overview, Income & expenses,
  Balance sheet and All reports above Update and Accounts. Import statements and
  Review leave the sidebar; they are reached from Update, which stays lit on
  them and carries the count of accounts with something waiting. After the last
  drafts are posted, Review offers "See your money", and the setup and add
  screens leave through "Back to Update".

- b273d72: Every report reads `from_date`, `to_date` and `as_of_date` the same way: a
  real `YYYY-MM-DD` calendar day, and a period whose `from_date` is not after
  its `to_date`. Trial Balance, Balance Sheet, Income Statement, Asset Inflows,
  Expense Breakdown, Account Ledger (and its hledger text), Day Book, Monthly
  Summary and Net Worth now answer 400 to any other date, which they used to
  compare as text. Income and Expenses already did.

  `@dbu6/app/server` exports the rule for a project's report contract:
  `reportDateRange`, `requiredReportDateRange`, `asOfDateQuery` and `isoDate`.
  The worked report in the guide uses `reportDateRange`.

- 22a4326: The report kit in `@dbu6/app/server` exports `loadAccountBalances`: each
  asset, liability or equity account's own balance up to a date, signed so what
  it holds or owes is positive, as the balance sheet reads it.
- ee97f89: The report kit in `@dbu6/app/frontend` exports `Checkbox`, the control the
  balance sheet's Show Equity option uses.
- ac64a61: The report kit in `@dbu6/app/frontend` exports `spanLabel`, which names
  picked days the way the period field does ("5–20 Mar 2026").
- 78e8a20: Every report has one period field: All time, the presets, From/To months over
  the days the books cover, exact dates on a calendar, and `[` and `]` to step
  the period by its own length. `GET /reports/books-span` serves the days the
  books cover, from the first posted journal to the last.

  - Income and Expenses gains All time, with a bar per financial year once the
    period runs past 24 months. Its month menus now start at the books' first
    journal (an opening balance included), not the first month with income or
    spending.
  - The Balance Sheet and the Trial Balance pick their day from today, the end
    of last month, the end of last financial year or a calendar. The Trial
    Balance now also shows how far that day is from today.
  - The report kit in `@dbu6/app/frontend` exports `booksSpanQuery`,
    `periodSpan`, `readReportPeriod`, `writeReportPeriod`, `upToToday` and
    `financialYearLabel`.

### Patch Changes

- 3d05093: The Balance Sheet and the Trial Balance read an `as_of_date` they can't read
  as today; the day picker used to break on one. The report kit in
  `@dbu6/app/frontend` exports `useAsOfDate()`, which keeps that day in the
  URL for a report of your own.
- b13efb0: A report opened with dates it can't read (`?period=custom`, a lone
  `from_date`, or dates that are invalid or out of order) now opens on its
  default period. It used to show all time's figures while the period button
  said "Pick dates".
- 198f1d9: Today is the date in the workspace's time zone everywhere. The Overview,
  asked for no month, used to show the month on the server machine's clock,
  which near midnight could differ from the month the screen counts; the date
  over Update used the browser's zone; and a token from `dbu6 agent env` was
  named with the date in UTC. All now read the workspace's zone.

## 0.3.2

### Patch Changes

- Pin @better-auth/core to 1.6.22 so npm resolves the adapter's peers

## 0.3.1

### Patch Changes

- Give the Excel export to Income and Expenses through the report kit

## 0.3.0

### Minor Changes

- 8142471: dbu6 no longer uses the Nuabase gateway: categorization and setup's chart of
  accounts run only on the coding agent chosen in Settings, so what dbu6 sends an
  LLM reaches that agent's own provider and nothing else. `LLM_ENGINE` and
  `NUABASE_API_KEY` are no longer read; remove them from the server's
  environment. A server with no coding agent, such as the Docker image, no
  longer categorizes; its imports go through uncategorized, as they do whenever
  no agent is installed.

## 0.2.1

### Patch Changes

- Expect the changelog among the files package.json ships by path

## 0.2.0

### Minor Changes

- 4456140: A project's settings file is `.env.development`, the name Sapporta uses, so
  every `sapporta` command finds the app's port without being told. `.env` is no
  longer read: every command stops until it is renamed by hand. `.env.agent`
  holds only the agent's token, which dbu6's `sapporta` adds to the CLI's
  environment, and the agent prompts name the app's own address.
