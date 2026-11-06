# @dbu6/app

## 0.6.0

### Minor Changes

- ce1629c: `GET /api/accounts/:id/activity` lists an account's running balance, a row
  per posted entry, other statement's draft and own draft, in the order its
  balance checks add them up, with each statement balance and its difference.
  `from` and `to` narrow the rows; `posted_only=true` counts posted entries
  alone, as Reconciliation Differences does. The books guide and the
  balance-check playbooks use it in place of the SQL they carried.
- 6685162: Every asset and liability account says how it starts. `GET
/api/opening-balances` returns `unanswered`, every leaf asset or liability
  with no opening entry; `empty_groups`, the groups banks, cards and loans are
  added under while nothing is on them (one carrying money is on
  `unanswered`); and `wrong_side`, balances, drafts included, on the wrong
  side for their type. An opening of 0 records "started here". Settings ›
  Opening balances lists the accounts with no starting balance with It had a
  balance, It started here and I don't have this (the Accounts page's delete,
  which refuses an account anything is on); Overview's net worth says
  "incomplete" and names them; `dbu6 check` lists both lists as information.

  `POST /api/opening-balances` takes the balance at the end of its `date`. A
  date on or after the account's first activity, refused before
  (`date_not_before_first_activity`), is now a balance known then: the opening
  posted is that balance less the account's movement through the day, dated
  the day before its first activity, and the answer carries the `date` and
  `amount` posted. Changing an opening still refuses such a date.

  The starter chart drops EPF, PPF, NPS, Employer PF, EPF Interest and PPF
  Interest.

- 1e46a47: Three more screens hand their job to the coding agent first, each keeping
  its by-hand way beside it.

  - **Accounts** leads its toolbar with **Reorganize my chart**: the agent
    renames, moves, merges or splits accounts with their entries, from what
    you ask for when you say go, or from changes it proposes. Each account's
    Edit dialog stays the by-hand way.
  - **Reconciliation Differences**, while a posted balance check misses its
    statement, shows **Find why this stopped matching**. Its prompt lists
    each check that misses, as account, date, books, statement, difference
    and journal, in aligned columns.
  - **Settings › Opening balances** shows **Fill in what you own and owe**,
    for cash, deposits, investments and loans, which have no statements. It
    starts a run at the "Accounts with no statements" section of `npx dbu6
docs run`, which reads the chart's opening balances itself, asks for the
    figures in the terminal, and records the ones you give. **Record a balance by hand** (/add/other) is the quiet
    link beside it.

  Two playbooks are new under `npx dbu6 docs playbook`: `posted-balance-check`
  and `chart-change`.

- d9ee2a2: The coding agent adds drafts to the books when the person asks it to; by
  default it still leaves them for Review. The books guide's "Add them to my
  books" says how, and the project's `AGENTS.md` line changes to match.

  Prompts that name a playbook take their report's headings from it and add
  only the screen's own next step. A refusal's playbook is found from
  `npx dbu6 docs playbook`, whose entries name the codes they cover; the run
  guide's table of refusals is gone. The rule for deleting a draft that
  carries its day's balance is stated once, in the books guide.

  The Reconciliation Differences prompt refuses a report row it can't read
  instead of leaving it out and counting fewer checks.

- 522fd4d: The guides now lead with the run. README, Getting started, Importing
  statements and Your books start from dropping statements on Update and
  pressing **Do my books**: your coding agent sets up, imports and
  categorizes, asks only what it can't settle, in one round in the terminal,
  and you add the entries on Review. The screen-by-screen path is kept under
  "By hand".

  For your coding agent, `npx dbu6 docs run` has more ways in than a pile of
  new statements, listed under "Entries":

  - **Starting from the drafts:** no new files. The agent surveys Review
    (`GET /api/review/accounts`, now with each account's `rule_requests`),
    encodes your rule requests first, then categorizes, cleans up, asks one
    round of questions and reports. Files waiting in the inbox are named, not
    imported, unless you say so.
  - **Accounts with no statements:** on a first run the question round asks
    what your cash, deposits, investments and loans held when the books
    start, creates any account the chart lacks, and posts each opening
    balance on your yes. The run's report no longer sends you to `/add/other`.
  - Two new playbooks: `posted-balance-check`, for a balance check in the
    books that stopped matching (Reconciliation Differences), and
    `chart-change`, for renaming, moving, merging or splitting accounts with
    their entries.

  The run's report now sends you to Review to add every ready account
  together, and lists each account that isn't ready with why. The agent never
  adds drafts to the books, inside a run or outside one: `DBU6-BOOKS.md` no
  longer has it call `post-to-journal` on a yes, and the run guide lists both
  posting endpoints under "Never". The only entries it records are opening
  balances: those the statements give, as before, and those you give it for
  accounts with no statements.

  `DBU6-BOOKS.md` no longer sends the person to a screen for work the agent
  can do: the agent adds a new bank or card from the statements named or
  waiting in the inbox, posts a suggested opening balance on a yes, and takes
  a refused statement to its playbook. Its screen links list the drop on
  Update first.

  A project made before this release can add the lines its new `AGENTS.md`
  has, under "Before you start": that the run's "Entries" list where else a
  run starts, that drafts are added by the person on Review unless they ask
  the agent to add them, and
  "Ask your questions in one round in the terminal."

- a134955: The coding agent's run is where a new user goes, and where every bank and
  card's statements go, new ones too. Before there is a chart, the run's card
  says the agent proposes your accounts for your OK before it imports
  anything. Setting up by hand (/setup, then /add's cards) is unchanged.

  On Update, an account's **Needs a first statement** leads to the drop on the
  same page, `/update#drop`, which scrolls to it and focuses **Choose files**;
  it used to open /add. **+ Add bank or card** under the list is gone: the
  drop says it takes statements from any bank or card, new ones too. Settings ›
  Banks & cards' **Add a bank or card** leads to the drop as well.

  Doing it by hand is still one small link beside the drop. In the first run
  it is **Add a bank or card** (/add) even while the first drafts wait, on
  Update and on Overview, until anything beside opening balances is posted
  (the home summary's new `posted`); **Import statements, guided** (/import)
  after. /import, which imports into the banks and cards
  already in the books, links to /add for a new one.

- 89a2ce2: Review's list now opens on what is left across every account: counts of
  transactions that need an account, possible duplicates, failing balance
  checks, accounts going in with one that isn't ready, and rule requests, with one
  **Fix these** button that hands all of it to the coding agent as a run
  starting at the run guide's "Starting from the drafts" section, whose
  survey reads what is left; the prompt holds no copy of the counts. Beside it,
  **Add N entries from K accounts to my books** adds every account that can
  go in, in one transaction, and then lists what it added and what it left,
  and why. An account's Overview has the same **Fix these**, naming that
  account, which the section then keeps to, while it has a block, or rule
  requests; the notice after an import points to it. Adding one account at a
  time stays.

  `POST /api/draft-transactions/post-ready` `{ base_account_ids }` is the
  new endpoint behind it, answering
  `{ posted: [{ account_id, name, drafts_posted }], left: [{ account_id, name, block }], first_post }`.
  It posts only the accounts named, those nothing of their own blocks whose
  balance checks pass counting the drafts of the others going in, all in one
  transaction; an account with no drafts left is neither added nor left; an
  id not in the books is refused with 404 and nothing posted. It is Review's
  button, and the agent's when the person asks it to add the drafts. `GET /api/review/accounts` and
  `/api/review/accounts/:accountId` now count each account's
  `rule_requests`, and `POST /api/draft-transactions/post-to-journal`
  answers `first_post`: whether the books held nothing but opening balances
  before it.

  "Your books are set up." now follows from the books: an Add all from
  books holding only opening balances puts the first run in Review's URL
  (`?run=setup`), as the by-hand first run does, and the list emptied on it
  ends the run, however many Add alls that takes. Review's empty states and the end of a post lead to
  Update ("Update your books"), with importing by hand a small link.

- 32abe70: One agent session can now do the books from a pile of statements. Drop every
  statement on Update and press **Do my books**: the
  files are saved under `tmp/statement-inbox/` (`/api/statement-inbox`) and
  listed, each with **Remove**, and the coding agent follows
  `npx dbu6 docs run`, which surveys them, writes parsers, adds the banks and
  cards, imports, categorizes across accounts with
  one round of questions, settles duplicates and balance checks, and stops
  with every account ready to add on Review. In a run the agent never adds to
  the books: the person does, account by account. Each problem's method is now a playbook (`npx dbu6 docs playbook`),
  which the app's agent buttons and the run share. A project made before this
  release can add the line its new `AGENTS.md` has: "When the person asks you
  to do their books, or points you at their statements, follow
  `npx dbu6 docs run`."

  A transfer or card payment that both statements carry is now caught while
  both sides are still drafts. A draft sent to another account counts on that
  account's balance checks, so the transfer counted twice fails them. The
  agent fixes it after every statement is imported and categorized, as the
  `double-counted-transfers` playbook says: it deletes the second copy, and
  blanks only the balance checks between the two dates that the transfer
  explains. Because the balance checks now count those drafts, the opening
  balance Settings › Opening balances suggests can change for an account with
  transfers.

  Adding drafts to the books counts other accounts' drafts only from the
  accounts added in the same press. Accounts whose checks count each other's
  drafts go in together on Review's Add all, in one transaction. Add on one of
  them alone is refused with `FAILING_ASSERTIONS`, whose new `relies_on` names
  the accounts it goes in with, and Review says "Waits on <account>".
  `GET /api/review/accounts` answers `add_all`, the accounts Add all would
  add, and each account's `relies_on`.

  `/add-account/read`, `/add-account/add` and `/import-draft/statements/auto`
  also take statements waiting in the inbox by path (`inbox_files`, repeated),
  read where they are rather than copied, and so does `/import-draft/abacus`
  (`inbox_files` in its JSON) for the file its rows were read from. An import
  deletes its files from the inbox once their rows are in the drafts and lists
  them in `inbox_files_imported`; for `/import-draft/statements/auto`, after an
  account fails, those of the accounts imported before it. A read, or an
  import that refuses, leaves them. `POST /api/statement-inbox/discard`
  deletes a file the person doesn't want imported, and
  `/api/statement-inbox/discard-all` every file. A path outside the inbox is
  refused with `not_in_inbox`.

  The first run's card, on Overview and Update while the books have no chart
  or nothing imported, is now **Do my books**. Setting up by hand is a link on
  it: **Set up by hand** (`/setup`), or **Add a bank or card** (`/add`) once
  the chart is there.

- 33419a9: A draft categorized to its own statement's account no longer posts. The
  Drafts grid could set one (the categorizer and Set account refuse it), and
  posting wrote both its lines on that account, netting to nothing, while its
  balance checks counted only the statement's side, so a check that passed
  before posting could fail after it. Now it blocks the categorization check:
  the draft counts as `on_own_account` in the draft counts (Home, Review) and
  among the block's `count` of drafts that need an account, and the block
  carries `on_own_account`. Review says "1 transaction goes to the account it
  came from". `POST /api/draft-transactions/post-to-journal` refuses with 422
  `DRAFTS_ON_OWN_ACCOUNT`, `uncategorized_count` and `on_own_account_count`;
  Add all leaves the account out with that block.
- c070613: Deleting a draft that carries its day's statement balance, as a duplicate
  or a transfer's second copy, moves the balance onto that day's new last
  draft, so the day keeps its check. It happens in the database, so the
  Drafts grid, `npx sapporta rows delete` and the table API all do it. A day
  left with no draft loses its balance, as before. This adds a migration:
  books on an older version refuse to open until `npx dbu6 upgrade`,
  `start` or `migrate` applies it.
- ee78ca2: Categorization rules name the statement they read.
  `user-config/transaction_mappings.mjs` exports `exact` and `contains` as
  lists of rules, each
  `{ statement, money, narrations | contains, amount?, mapToAccount }`:
  `statement` is the account whose statement prints the row (a name, a list,
  or `"*"` for every statement), and `money` is `"in"`, `"out"` or
  `"either"`, relative to it. The rules read the row's statement, as the AI
  does, so a rule never claims a row on a statement it doesn't name, and
  never answers with the row's own statement account: that row goes on to
  the next rule or the AI.

  The old format (`includes`, and `exact` keyed by narration) is refused at
  load, with a message saying so; the file is rewritten by hand in the new
  one. A rule whose `statement` names an account the books don't have is
  refused too: imports, reclassification and the preview refuse the file,
  naming the rule, until it is fixed, and the Categorization rules page shows
  it as unreadable. `dbu6 check` reports "N exact and M contains rule(s)", or
  the same refusal.

  `POST /api/categorization-rules/preview` runs one rule, on its own, through
  the categorizer's own matching over the drafts and the books, and answers
  what it matches per statement and where those rows sit now. A body not in
  the file's shape is a 400; a rule the file would refuse is a 422. The
  guides have the agent preview a rule before proposing it, and propose it
  statement first.

  The Categorization rules page shows each rule's statement before its
  limits.
  `GET /api/import-presets/transaction-mappings` answers the new shape.
  `LoadCategorizer`'s `classify` takes the whole row,
  `StatementTransaction { transaction, statementAccount }`, instead of the
  transaction alone, and its settings carry `accountNames`, the books'
  account names: a project that replaces the categorizer changes its
  classifier's signature.

  Upgrade note for the version commit: rewrite `transaction_mappings.mjs` in
  the new format, naming each rule's statements by their exact names in
  Accounts, then run `npx dbu6 check`.

- 61cab73: Update is laid out around finding the statements it needs, in the order
  you work. First, **Download these statements** lists each bank and card on
  one line, with its **Download from** month and the day it was imported
  until, posted or still in the drafts. The month is the one its statements stop in, posted or still in the
  drafts, so statements up to 13 October ask for October, and up to 30
  September ask for October too. The home summary (`/api/home`) carries each
  account's `statements_until` for it. Under the list, the drop says **Drop
  them here** and carries the page's weight: it is tinted green and larger,
  and its **Choose files** is the primary button until a file is uploaded.

  The files uploaded are listed under the drop, as **Files to add**, and the
  run's button under them says what it does: **Add 3 files to my books**.
  **Import new statements** is gone: beside the button, a quiet **Import
  statements, guided** link leads to /import, which carries that name too.
  The **Do my books** heading and its paragraph are gone; one line under the
  button says what happens, with ⓘ for more. Dropping a file already there,
  under any name, doesn't add it again: `POST /api/statement-inbox` skips it
  and names it in `already_uploaded`.

  In a run, a text file no parser reads is imported freeform, with no parser,
  and the plan asks what it doesn't say: the account, and the opening and
  closing balances. The run's report opens with one link, to Review.

### Patch Changes

- 340e5da: The run now picks up the rule requests you left in Review when you drop new
  statements: it lists them in its first message and encodes them before
  categorizing, so it doesn't ask again what you already answered.

  Fix these on one account asks about opening balances only for the accounts
  its drafts go to. Its report still names the others with no starting
  balance.

  A balance check that a transfer could explain can now be worked from the
  Balance checks tab while other accounts still have uncategorized drafts: only
  a run waits for those. `categorize` now holds how to treat a transfer, and a
  rule's limits live only in `npx dbu6 docs books`.

- 033c4fa: `npx dbu6 agent env` works while the app is running. It used to stop with
  "Another dbu6 process … is using this folder", because it migrated the
  database first, which takes the folder's lock. It no longer migrates: a
  database with migrations still to apply is refused, and `npx dbu6 migrate`
  (or `npx dbu6 dev`) applies them.

  Every account gets an agent token, the one signed up as `demo@example.com`
  included: handing a prompt to the coding agent no longer skips it. In a
  project with more than one account, `agent env` always asks which with
  `--user`; before, it took the other one when one was `demo@example.com`.

- 3075c0f: Adding drafts to the books never leaves a balance check in the books
  failing. When two accounts each end a day on a transfer to the other, no
  order of their entries can meet both statements' balances, though each
  account's drafts pass their checks: Add, Add all and their endpoints
  (`POST /api/draft-transactions/post-to-journal`, `/post-ready`) now refuse
  that with 422 `POSTED_CHECKS_WOULD_FAIL`, naming the account, and add
  nothing. Before, Add all added them and Reconciliation Differences then
  showed a check no fix could clear.
- e3f5b25: A run of **Do my books** now talks to someone who has never seen dbu6. The
  agent sends three messages, each from the user's own statements: what you
  gave me (the accounts, what it will do, only what blocks an import), what
  your money looks like (money in and out, the categories fitted to it, then
  the questions), and what to do now (next steps first, then what changed).
  It explains a thing once, when it first comes up, and leaves out parsers,
  presets and phases. On books with no chart the run starts from the standard
  chart, less the accounts the setup checklist leaves unticked, and fits it
  to the transactions instead of showing a chart before reading them.
- 305c73f: The app no longer loads fonts from Google Fonts. Schibsted Grotesk now ships
  with the package, and monospace text (amounts, file names, hledger output)
  uses the computer's own monospace font in place of IBM Plex Mono.

## 0.5.1

### Patch Changes

- Import Income and Expenses' Temporal, button and icon through the report kits

## 0.5.0

### Minor Changes

- 0971393: Settings › Opening balances says "From account statement" only while a
  recorded opening is the balance its first balance check implies, and
  "Manually recorded" otherwise. That now holds for any asset or liability
  with balance checks, not only a bank or card from an import preset, and a
  bank or card whose statements print no balance reads "Manually recorded".

  `GET /opening-balances` replaces `suggested_amount` with `implied_opening`:
  the opening the first balance check implies, counting what is posted and
  what is in drafts before it. It no longer turns null once something is
  posted, so the Settings dialog and /add/other prefill it for an account with
  posted entries and no opening, and drafts dated before a posted check count
  in it. Each recorded `opening` carries `source`: `"statement"` or
  `"manual"`.

- f597dfd: Spending by category on Overview shows each category's months as a
  sparkline in place of its Average column, under a "Last N months" header.
  The bar beside each name now sits before it and measures the category's share
  of the month's spending.

  `GET /api/overview` gives each category its `monthly` amounts, with `null`
  for a month before the books start. Each of `months` holds that month's
  income and spending under `amounts`, `null` for such a month, in place of
  `income` and `spending` filled with zeros. It lists `Other` as the last
  category, with a null `account_id`, for what the listed ones leave of the
  spending; its amounts are no longer rounded to cents, like the listed ones'.
  Other now also shows when its amount and average are both zero but a month of
  it is not, as when a spend and its refund cancel out, and the table shows when
  Other is the only category.

### Patch Changes

- 16821c0: `dbu6 check` reports a `.env.agent` that holds no token as missing rather than
  ready.
- 5e5a767: `dbu6 agent env --print` exports the token in `.env.agent` only when the app
  accepts it. A revoked, expired or other books' token there used to be printed
  as it was; now a fresh token is minted and printed instead, with the note that
  nothing stores it. `dbu6 check` likewise reports such a token as missing
  rather than ready, and one it has no database to check against as unchecked.
- f697bd0: Handing a prompt to the coding agent now gives the project an agent token when
  `.env.agent` holds none the app accepts, minted for the signed-in owner, so the
  agent can reach the app without asking you to run `npx dbu6 agent env`. A
  `.env.agent` whose token still works is left as it is, whoever it is for; one
  whose token was revoked, has expired or belongs to other books gets a new one,
  and, as with `npx dbu6 agent env`, minting it revokes the tokens dbu6 minted
  for you before. Nothing is minted for the sample account the sample-data seed
  makes, for a request an agent makes with its own token, or when the handoff is
  refused because no coding agent or model works.

  `npx dbu6 agent env --print --user <the sample account>` in a project whose
  `.env.agent` holds a token now prints that token, as `--print` does for any
  account, instead of refusing.

- 44ed400: dbu6 now recognises the agent tokens it writes to `.env.agent` by a purpose
  stored with the token rather than by its name, so a token you make in the app
  is never revoked, whatever you call it. Tokens are named after what made them:
  `dbu6 agent env`, or `Prompt handoff` when handing a prompt to the coding
  agent made one. A migration marks the tokens dbu6 wrote before, so the app
  needs a restart to apply it.
- 41bdef6: The `sapporta` command reads the coding agent's token from `.env.agent` itself,
  as Sapporta now does for any project, and dbu6 writes the file through
  Sapporta: dbu6's own reader of the file is gone, and its `sapporta` bin only
  forwards to the CLI. The CLI finds the project by its `sapporta.json`, which
  every dbu6 project has; a folder without one no longer has its `.env.agent`
  picked up. In the dbu6 checkout itself, `dbu6 check` says `npx sapporta`
  works there too, since it is the same CLI.
- f76f4bc: Copying a prompt for the coding agent works where the browser refuses the
  Clipboard API, as the in-app browser of the Claude desktop app does: the copy
  falls back to a selected textarea instead of silently doing nothing. A copy
  now says "Copied to clipboard" with a green check, and with no coding agent
  set up, a dialog says to open the agent in the project folder and paste the
  prompt there, and that Settings can have dbu6 open it instead. On /add, Set
  up this format is the card's primary button and Check again has an icon.
- d39bfcf: Overview's month chart and spending sparklines now draw the month and the
  twelve months its averages cover, so every month in an average is on the
  chart; before, they drew the month and the eleven before it. `GET
/api/overview` lists thirteen `months`, and each category's `monthly` follows
  it. The averages themselves are unchanged.
- 5ac9db2: `dbu6 seed` is gone. The sample books were a tool for developing dbu6 and are
  no longer shipped in the package.

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
