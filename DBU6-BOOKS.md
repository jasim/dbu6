# DBU6-BOOKS.md

The user keeps their personal books in dbu6 and asks you about them in plain
words. They may not know bookkeeping, SQL or APIs. This file tells you how to
talk to them, what you may change, and where each everyday answer comes from,
so you can skip OpenAPI discovery. For anything not covered here, use the
`sapporta` skill's data-console guide.

## Talking to the user

- **Use the app's words, not the data's:**

  | In the data                      | Say                                                          |
  | -------------------------------- | ------------------------------------------------------------ |
  | draft                            | an imported transaction waiting in Review                    |
  | post                             | add to your books ("Add N to my books" on Review)            |
  | base account                     | the bank or card account the statement is for                |
  | `account_id` on a draft or entry | the account it goes to                                       |
  | balance assertion                | the balance printed on the statement                         |
  | failing balance check            | on that day the running total misses the statement's balance |
  | journal, entry                   | a transaction in your books                                  |
  | last reconciled checkpoint       | the last statement balance in your books, and its date       |

- **Money:** show amounts with Indian digit grouping (1,23,456) and no
  currency sign. For a card or loan, say "you owe X" instead of showing a
  minus sign.
- **Answer first:** give the amount or the cause, with the period used. Then
  say what the answer leaves out. Reports count only transactions already in
  the books: not drafts waiting in Review, and nothing after the last imported
  statement. Show two or three of the transactions as evidence. If you are
  unsure, say so; never guess an amount.
- **Periods:** the app's periods use the financial year (1 April to 31 March).
  When the user says "this year", say which year you used, or ask.
- **Link the screen** where the user can see it. The base URL is
  `SAPPORTA_PUBLIC_APP_URL`, set in the project's `.env.development`. Read it; do not
  assume a port: the template's `http://localhost:2345` is only a default, and
  a second project on the same machine is on other ports.
  - Home: `/`
  - Import statements: `/import`
  - Review: `/review/<account id>`, with the tabs `/drafts`,
    `/improve-categorization`, `/run-categorizer`, `/duplicates` and
    `/balance-checks`
  - Reports: `/reports/<report>`, for example
    `/reports/account-ledger?account_id=<id>`
  - Accounts: `/accounts`
  - Setting up the books: `/setup` (the chart of accounts); adding a bank
    or card: `/add`; recording cash, a deposit, an investment or a loan:
    `/add/other`
  - Settings: `/settings`, with Banks & cards (`/settings/banks`) and
    Opening balances (`/settings/balances`)

## Before changing anything

- Reading needs no permission. Every change does. Describe it in the user's
  words (date, description, amount, old → new account, and how many), then
  wait for a yes.
- After a change, run the check that prompted it again, such as the Review
  status or the report, and tell the user what the screen now shows.
- The balances printed on statements are the bank's numbers. Never change
  `balance_assertion_base_account` or `account_balance_assertion`, and never
  delete transactions, just to make a check pass. Find what is wrong with the
  transactions instead.
- Only a day's last draft carries that day's statement balance. Before deleting
  it, move its balance onto the day's new last draft.
- Adding drafts to the books deletes them, and the app has no undo.
- Write through the CLI or API, never through SQLite.
- Nothing from the user's data goes into a tracked file (see AGENTS.md on PII).

## Everyday requests

Run every command here from the project root
([Reaching the app](#reaching-the-app) has the `npx sapporta …` rule, and the
table and endpoint subcommands).
Look up an account's id with
`npx sapporta rows list accounts --where '{"name":{"eq":"<name>"}}'`.

### Questions about money

- **"Where do my books stand? What's waiting?"**
  `npx sapporta api get /api/home` lists each import account with its last
  statement balance in the books and what is waiting in Review.
- **"How much did I spend on X?", or "…in this period?"**
  `npx sapporta api get /api/reports/income-expenses --query '{"from_date":"…","to_date":"…"}'`
  returns income and spending as account trees: each `total` includes the
  account's sub-accounts and is positive. It also returns monthly totals. Only
  income and expense accounts count, so transfers between the user's own
  accounts and card payments are not spending.
- **"Why did I spend more?", or "Why is my net worth down?"**
  Compare `income-expenses` for two periods account by account, or
  `balance-sheet` at two dates. Tell real spending apart from transfers and
  from statements not yet imported.
- **"My balance doesn't match my bank app."**
  The books stop at the last statement added. `/api/home` gives that date and
  balance for each account. The difference is whatever happened after that
  date, plus the drafts still waiting in Review.
- **"Show me this account's history."**
  `/api/reports/account-ledger` with `account_id`, `from_date` and `to_date`.
  It includes sub-accounts. Each row is one entry on the account, with
  `narration` (the entry's comment, else its source narration, else the
  journal's description), the account it was `against`, and the balance
  after it. An
  older grouped journal gives one row per statement transaction in it; a
  compound entry, such as a salary, lists every account on its other side.
- **"Find the transaction …"**
  For transactions in the books: `npx sapporta rows list journal_entries --q "<words>"`.
  For drafts waiting in Review:
  `npx sapporta rows list draft_transactions --q "<words>"`. Both search the
  `comment` and the `source_narration` ([Two texts](#two-texts-the-banks-and-the-persons)).
  For anything fuzzier, use SQL.

### Transactions waiting in Review

- **"Why won't these go into my books?"**
  `npx sapporta api get /api/review/accounts/<id>`. Drafts are added only when three
  checks pass, in this order: every draft goes to an account; there are no
  possible duplicates; every balance check passes.
- **"Categorise these."**
  - List the drafts with no account:
    `npx sapporta rows list draft_transactions --where '{"base_account_id":{"eq":<id>},"account_id":{"is":"null"}}'`.
  - Set one by hand:
    `npx sapporta rows update draft_transactions <draft> --values '{"account_id":<account>}'`.
    Never send a draft to its own base account. For many drafts at
    once, all or none:
    `npx sapporta api post /api/draft-transactions/set-account --body '{"ids":[…],"account_id":<account>}'`.
  - Or run the categoriser again:
    `npx sapporta api post /api/draft-transactions/classify --body '{"ids":[…],"custom_mappings_filenames":[…]}'`.
    It overwrites every draft you pass, and leaves blank any it is unsure of.
    So pass only drafts with no account. Pass the account's own instruction
    files, in order: `custom_mappings_filenames` of the account in
    `npx sapporta api get /api/import-presets` whose `account_id` is this account
    (see [Import presets](#import-presets)).
  - Setting a draft by hand teaches the categoriser nothing. To make it stick,
    add a mapping (next section).
- **"Is this a duplicate?"**
  `npx sapporta api get /api/reports/duplicate-drafts --query '{"base_account_id":<id>}'`.
  A draft is compared with other drafts on the same account, and with
  transactions in the books on that account that don't say which statement row
  they came from (entered by hand, or an older import), or that came from this
  same row. A transfer already added from
  the other account's statement usually shows up as a failing balance check
  instead (see below).
- **"Add them to my books."**
  `npx sapporta api post /api/draft-transactions/post-to-journal --body '{"base_account_id":<id>}'`.
  A 422 names the first check that still blocks.
- **"Remove this one."** `npx sapporta rows delete draft_transactions <id>`.

### "Always put this under X" — adding a mapping

The most frequent request. Two files, and the choice is whether a literal
string in the narration settles it. Both read the bank's text, a draft's
`source_narration`, never its comment:

- **Yes** → a rule in `user-config/transaction_mappings.mjs`; the file's
  comments have the shape. Prefer this: free, instant, and it applies to every
  account. An `account` that is not a name in Accounts silently leaves the row
  uncategorised. A contains rule can be limited to one direction and to an
  amount range (`amount: { min, max }`, either end open), for a phrase that
  alone would also catch other payments.
- **No** → a line in a `custom_mappings_*.prompt` file in `user-config/`,
  read by the AI after the rules miss. It applies only to the accounts whose
  import preset lists that file (`custom_mappings_filenames`; see
  [Import presets](#import-presets)). The AI sees each transaction's
  direction and amount beside its narration, so a line may give an amount
  range too.

Neither sees the date. A string shared only by how the money moved (`UPI`,
`NEFT`, `IMPS`, `POS`, `ATM`) settles nothing: a rule on it catches every such
payment. Before adding a rule, count what it would have caught among the
transactions already in the books that are in other accounts. Give a range
from the amounts seen, rounded out to round figures, not the exact amounts.

Neither is retroactive: re-run the categoriser over the drafts with no
account ("Categorise these" above), and restart a server started with
`dbu6 start`.

**Rule requests from Review.** The Improve categorization tab keeps the rule
requests the user made there, each with its drafts (date, source narration,
direction and amount), the account they go to and a note:
`npx sapporta api get /api/categorization-rule-requests --query '{"base_account_id":<id>}'`.
Their drafts have no account yet; the user runs the categorizer once the
rules are in. The user picked the drafts, so they may share nothing the
categorizer can see; propose each change, and say so when they don't, before
writing anything. Once a rule request is a rule or guidance, delete it, which
takes it off the user's list:
`npx sapporta api delete /api/categorization-rule-requests/<rule request id>`.
Leave a rule request you couldn't encode.

### Fixing the books

- **"All my X payments are in the wrong account."**
  1. Preview with SQL: how many transactions, their total, and a few examples.
     A loose pattern catches the wrong ones.
  2. Update each entry's `account_id`, one `npx sapporta rows update
     journal_entries <entry id> --values '{"account_id":<account>}'` per
     entry.
  3. Update the matching drafts too.
  4. Add a mapping so future imports get it right (above).
- **"This one transaction is in the wrong account."**
  Update the categorized account's entry's `account_id`. Never change the
  line on the statement's own account. If the old or new account is itself a bank or
  card account, as in a transfer or card payment, the change moves that
  account's balance checks. Check `balance-assertions` afterwards.
- **"Add a transaction by hand."**
  `npx sapporta rows create journals --values '{"date":"…","description":"…","$details":{"table":"journal_entries","fk":"journal_id","rows":[{"account_id":<a>,"debit":500,"comment":"…"},{"account_id":<b>,"credit":500}]}}'`.
  Debits must equal credits.
- **"Undo that."**
  There is no undo. An imported journal holds one statement transaction;
  journals imported before 2026-09-24 hold a day's same-direction
  transactions (see [The data](#the-data)).
  - To remove a one-transaction journal: delete its entries first, then the
    journal. If its statement-account line has an
    `account_balance_assertion`, that is the day's closing balance from the
    statement, and deleting it takes the day's balance check with it. Move it,
    unchanged, onto the statement-account line of that day's previous journal
    first. When no other journal is on that day, say so: the day loses its
    check, and if it was the account's last, the next import starts from the
    day before and brings back whatever that statement still shows. If the
    transaction is real but misfiled, change its categorized account
    instead of deleting it.
  - To remove one transaction from an older, grouped journal: delete its
    categorized account's entry, and reduce the statement account's line by the same
    amount.

  Either way, every later balance check on that account moves. Check
  `balance-assertions` afterwards.

### Accounts and imports

- **"I opened a new account or card."** Send the user to `/add` (Home's
  **+ Add** › Bank or card), where they drop its statements: dbu6 reads
  them, sets the account up with its opening balance, and imports them, in
  one go. Nothing is written until the statements are read and checked. A
  bank dbu6 can't read yet leaves nothing in the books; once its parser
  exists (`npx dbu6 docs parsers`), the user drops the files again. Its two
  endpoints take the files as multipart `files`, repeated (curl, as under
  [Reaching the app](#reaching-the-app)):
  - `POST /api/add-account/read` writes nothing to the books. Each file has
    a `status`: `read` (with the `account_key` it belongs to, its parser,
    period and row count), `unrecognized` or `ambiguous` (no saved parser
    reads it, or several do). Each account the files belong to has a
    `status`: `new` (no bank or card takes them), `empty` (a bank or card
    set up with no transactions yet) or `in_books` (its statements go
    through `/import`). With it come its bank (`institution`, and
    `institution_listed` when a preset institution lists the parser), its
    `kind` (`bank`, `card`, or `null` when the statements print no account
    number), the printed `identifier`, the `period`, `transactions`, the
    `opening` the statements give the day before their first row (ledger
    sign; its `amount` is `null` when they print no balance, and then
    `needs_opening`), an `opening_refusal`, and `refusal`, the refusal
    `/import` would give, in `/import`'s words. `categorizer` says who
    categorizes the import. Files are kept under `tmp/statement-uploads/`
    (each one's `saved_path`) only when a coding agent needs them: the files
    no parser reads or several do, or all of one account's files (not in
    the books) when its refusal is one `/import` gives a prompt for. The add
    keeps nothing.
  - `POST /api/add-account/add` takes one account's files again, with form
    fields: `name` (a new account, under `parent_id`) or `account_id` (an
    Asset or Liability from the chart that no bank or card uses);
    `institution`, the bank's name, only when `institution_listed` is false
    (a preset institution of that name, whatever its case and spacing, is
    the one used); `kind` only when it is `null`; and `opening_amount`,
    signed, only when `needs_opening`. `parent_id` defaults to the parent
    most banks or cards of the kind share, and for the first of its kind
    to the type's top account (Assets, Liabilities): `default_parents` of
    `npx sapporta api get /api/setup/statement-accounts`. Where that is `null`
    (the type has several top accounts), send it, picked with the user
    from `parents.bank` or `parents.card` (else "Pick a parent account for
    it."). An `empty` account needs only `opening_amount`, when asked.
    In order, each step refusing before the next writes, it checks the
    files as the import would, makes the ledger account and its preset
    entry (for an `empty` one, lists the parser and number it lacks),
    records the opening balance unless the account has one that agrees,
    and imports the files as `/import` does, categorization included. It
    replies `account_id`, `account_name`, `drafts`, and `categorized`, how
    many of the drafts the rules or the coding agent categorized. Sent
    with a `progress_id` field, the add answers
    `GET /api/add-account/progress/<progress_id>` while it runs: its
    `stage` (`account`, `rules`, `llm`, `saving`) and its `rows`, each
    with the account answered so far and whether the rules or the coding
    agent answered it. It stays readable, at stage `done`, for a minute
    after the add answers.
    A refusal has a
    `code` and an `error`; among them `several_accounts` (the files are two
    accounts'; add one at a time), `already_in_books`,
    `opening_balance_needed`, `opening_after_statement_start` (the
    account's opening entry is dated on or after the first row),
    `opening_disagrees` (dated the day before, at another balance),
    `activity_before_statement` (another account's import put a
    transaction on it before the statements start), and `import_refused`
    with the import's own `import_error`. Only the import's own last step
    (duplicates, the categorizer failing) can leave an account set up with
    no transactions; dropping its files again finishes it, as `empty`.
  - For example, read a drop, then add it as a new account:
    `curl -sS -H "Authorization: Bearer $SAPPORTA_API_TOKEN" "http://localhost:<port>/api/add-account/read" -F "files=@<path>" -F "files=@<path>"`,
    then
    `curl -sS -H "Authorization: Bearer $SAPPORTA_API_TOKEN" "http://localhost:<port>/api/add-account/add" -F "files=@<path>" -F "files=@<path>" -F "name=<account name>" -F "parent_id=<id>" -F "opening_amount=<signed>"`,
    with the port and the token as **Uploads** under "Reaching the app" says,
    leaving out `opening_amount` unless the read said `needs_opening`.

  To set a bank or card up without its statements, the endpoint behind
  Settings › Banks & cards makes the ledger account and its preset entry in
  one transaction, adding the institution when it is new; a refusal leaves
  neither:
  `npx sapporta api post /api/setup/statement-accounts --body '{"action":"create","kind":"bank","institution":"…","identifier":"<number or null>","ledger":{"source":"new","name":"…","parent_id":<id>}}'`.
  Its statements, dropped at `/add` later, find it (`empty`).
  - `kind` is `bank` (an Asset) or `card` (a Liability, `is_credit_card`),
    and the parent must be of that type; pick it with the user, never from a
    name. `"ledger":{"source":"existing","account_id":<id>}` uses an Asset or
    Liability account no preset lists instead.
  - The number is the full account number, or a card's masked number as
    the statement prints it (`050505XXXXXX0505`). An institution with two
    accounts needs one on each.
  - `{"action":"update",…}` and `{"action":"remove","account_id":<id>,"delete_account":true}`
    change or remove one, but only while it has no transactions of its own
    (`account_has_transactions`), the rule `/add` and Home use: its opening
    entry and what other accounts' statements put on it don't count. On
    screen, that is Settings › Banks & cards (`/settings/banks`). Removing
    one deletes its opening entry when that journal opens it alone, and
    `delete_account` is refused while other statements' transactions are
    on it. With only drafts, deleting them frees it; after an entry, use
    the Accounts page and [Import presets](#import-presets).
  - `npx sapporta api get /api/setup/statement-accounts` lists them, each with
    its count of its own `entries` and `drafts`.

- **Setting up the books.** The first run is a run of cards, one question
  each, and keeps nothing but the URL: `/setup` picks the chart of accounts,
  `/add?run=setup` adds the banks and cards one at a time, `/add/other`
  records cash, deposits and loans, and Review takes over. Home resumes from
  the books: no chart opens `/setup`, a chart with no bank or card
  `/add?run=setup`. A bank or card counts as imported once it has entries
  (its opening entry aside) or drafts from its own statements; a card
  payment another account's import posted to it doesn't count.
  - `npx sapporta api get /api/setup/chart-of-accounts` gives books with no
    accounts a starter chart, and `POST` with `{"accounts":[…]}` creates one,
    each account naming its parent by name. It refuses books that have any
    account.
  - Cash, a deposit, an investment or a loan (`/add/other`) is an account
    in the chart; add a missing one on the Accounts page first. Its
    balance is recorded as an opening balance (below), dated by default the
    day before its first activity, else the day the books start.
- **Opening balance.**
  `/add/other` records one for an account the user owns or owes (not a
  bank or card: its first statements set its balance). Settings › Opening
  balances (`/settings/balances`) changes and removes them, and records a
  missing one; `/opening-balances` redirects there, keeping its
  `?account=`, which names an account by name or path and opens its row.
  Send the user to one of those. Their endpoints do the same:
  `npx sapporta api get /api/opening-balances` lists every asset and liability
  account with its `section`, first transaction, a default date, a
  suggested amount and its `opening` entry, and
  `npx sapporta api post /api/opening-balances --body '{"account_id":<id>,"date":"YYYY-MM-DD","amount":<signed>}'`
  posts one. `"description":"…"` names its journal; left out, it is
  "Opening balance".
  - `section` is where the Opening balances page lists the account: `own`
    (an asset) or `owe` (a liability), in account order, which `/add/other`
    offers while they have no opening, then `statement` (a bank or card an
    import preset lists, whose first statement set its balance). A group
    account with no opening entry is `null` and not listed.
  - The screens ask for what the account held, or what was owed on it, as a
    positive number; a leading minus means overdrawn or in credit. The
    endpoint's amount is signed like the assertion: positive when held,
    negative when owed. The date must be before the account's first draft
    or entry, counting drafts categorized to it from another account's
    statement. `first_activity_date` is that first draft or entry, leaving
    the opening entry out; `default_date` is the day before it, else the
    day the books start (their earliest opening entry).
  - It posts one journal: the account's line, a debit for money held or a
    credit for money owed, with the same amount in
    `account_balance_assertion`, and the opposite line on the Equity account
    Opening Balances, created on the first save.
  - An account has an opening entry when one of its lines sits in a journal
    with a line on an Equity account. The endpoint refuses a second one
    (`already_recorded`).
  - `npx sapporta api put /api/opening-balances/<account id> --body '{"date":"YYYY-MM-DD","amount":<signed>}'`
    changes it in place, and
    `npx sapporta api delete /api/opening-balances/<account id>` removes it
    (Opening Balances stays). Both work while `opening.locked` is `null`:
    the opening entry is the only posted entry on the account, and its
    journal holds just the account's line and one Equity line. Drafts don't
    count. Any other posted entry locks it (`has_entries`), as does a
    journal that opens other accounts too (`shared_entry`, as the seeded
    books' and an hledger import's do). A locked one refuses with a 409
    naming `journal_id`; edit the account's line and the Equity line in
    that journal instead, which moves every later balance check.

  Without an opening balance, every balance check fails by the same amount.

- **"Rename or move an account."**
  `npx sapporta rows update accounts <id> --values '{…}'`, with the name, type and
  parent in the one update: a trigger refuses a cell saved alone when it
  disagrees with the rest of the tree. Rules and prompt files name accounts by
  name, so make the same rename in `user-config/`: `transaction_mappings.mjs`
  and the `custom_mappings_*.prompt` files. The import presets name the
  account by its id and need no change.

  Changing the type of an account that has sub-accounts is
  `npx sapporta api put /api/accounts/<id> --body '{"name":"…","account_type":"…","parent_id":<id or null>}'`:
  one transaction moves the account and its whole branch, which no single
  `rows update` can do (the trigger refuses a parent and child of different
  types). It answers `{account, moved}`, and refuses a 422 with a `code` and
  the `field` it is about: `unknown_account`, `name_required`,
  `ledger_name_taken`, `parent_not_suitable`, `opening_balances_fixed`
  (Opening Balances keeps its name and stays Equity) and
  `bank_or_card_type_fixed` (a bank's or card's type follows its import
  preset; change it in Settings › Banks & cards). Posted entries don't stop a
  retype: every amount carries its own sign, so only the report it lands in
  changes.

  Deleting an account is
  `npx sapporta api delete /api/accounts/<id>`, which refuses a 422 and names what
  is in the way: `has_sub_accounts`, `bank_or_card` (remove it in Settings ›
  Banks & cards, so its preset goes too), `has_entries` and `has_drafts`.
  Deleting through the generated table API skips those rules, and an import
  preset names an account by id inside JSON with no foreign key, so a raw
  `rows delete` can leave a preset pointing at an account that is gone.
- **"This statement won't import."**
  The Import screen gives a prompt for each problem. Parser work follows
  the parsers guide (`npx dbu6 docs parsers`), and failed uploads are kept in
  `tmp/statement-uploads/`. The common refusals:
  - `opening_balance_unavailable`: the account has no balance in the books
    yet. Record the opening balance (above), then import again.
  - `reconciliation_match_failed`: nothing in the statement lands on the last
    statement balance in the books. A statement in between is probably
    missing.
  - `balance_mismatch`: the statement's rows don't add up to its closing
    balance. `suspected_gap` means a period is missing.
  - `statement_boundary_mismatch` with `same-statement-twice`: the same
    statement was uploaded twice.
  - `import_account_not_found`: the import preset's account names a ledger
    account that was deleted. Point it at another account: in one batch,
    `remove_account` and then `add_account` with the new id and the same
    fields (see [Import presets](#import-presets)).
  - `auto_import_files_unresolved`: a file's parser is in no institution, or
    no account of the institution lists the identifier the statement prints.
    Each file's `reason` says which; fix the presets (see
    [Import presets](#import-presets)).
- **Categorisation rules** run before the AI, which is offered every account
  except Equity for whatever is left. To add or change one, see
  ["Always put this under X"](#always-put-this-under-x--adding-a-mapping).

## When a balance check fails

The running total adds every transaction in the books on that account,
including ones added from other accounts' statements. Then it adds the drafts,
by date and then by id; on the same date, transactions in the books come
first. Only a day's last draft carries the statement's balance, and a check
passes when the two are less than 0.005 apart. `diff` is the running total
minus the statement's balance.

Usual causes:

- **The same difference from the very first check:** no opening balance is in
  the books. Record it on Settings › Opening balances
  (`/settings/balances?account=<name>`), which suggests the amount from
  that first check.
- **A difference that starts on one day:** a transfer or card payment is
  already in the books from the other account's statement, and a draft
  repeats it. `diff` equals its amount.
- **A missing or extra draft:** the parser dropped or doubled a row.
- **A statement between the last one in the books and this one** was never
  imported.
- **A transaction added later,** by hand or from another statement, dated
  inside this statement's period.

Find the first failing day. List the activity around it with the running
total, and look for an amount equal to `diff`, or to the change in `diff`
between two failing days. Replace `<id>`, `<from>` and `<to>`:

```sql
WITH activity AS (
  SELECT j.date, 0 AS src, j.id AS o1, je.id AS o2, 'entry' AS kind, je.id AS row_id,
         je.debit - je.credit AS delta, je.account_balance_assertion AS assertion,
         COALESCE(je.source_narration, je.comment) AS text
  FROM journal_entries je JOIN journals j ON j.id = je.journal_id
  WHERE je.account_id = <id>
  UNION ALL
  SELECT d.date, 1, 0, d.id, 'draft', d.id, d.deposit - d.withdrawal,
         d.balance_assertion_base_account, d.source_narration
  FROM draft_transactions d WHERE d.base_account_id = <id>
), running AS (
  SELECT *, ROUND(SUM(delta) OVER (ORDER BY date, src, o1, o2
                                   ROWS UNBOUNDED PRECEDING), 2) AS running
  FROM activity
)
SELECT date, kind, row_id, delta, assertion, running,
       ROUND(running - assertion, 2) AS diff, text
FROM running WHERE date BETWEEN '<from>' AND '<to>';
```

## Two texts: the bank's and the person's

Every imported row, a draft and the posted entry on its categorized account,
keeps two texts that never overwrite each other:

- `source_narration`: the statement's text as the import saw it, with the
  Google Pay recipient in front (`Recipient | …`) when a takeout matched the
  row. It is written once and never changed, and it keeps the references
  that map back to the statement. A manual entry has none.
- `comment`: a short, readable line the person owns. The app's comment
  writer fills a null one in the background from the source narration,
  extracting its meaningful words; a Google Pay recipient becomes the
  comment at import. Until then it is null.

Which to read:

- To show a transaction: `comment`, else `source_narration`. A null comment
  is not written yet, never blank.
- For anything that must match the bank's text: `source_narration` only.
  Mapping rules, the categoriser, rule requests, duplicate matching and
  balance checks all read it.
- To find a transaction: search both; `--q` does.

Edit `comment` only. Never change an existing row's `source_narration`.
Recording a statement row by hand, set `source_narration` to the statement's
text; a note typed by hand goes in `comment`. A journal's `description` is a
copy of the row's comment, else its source narration, made at posting; the
comment writer updates it once when it writes a one-row journal's comment,
and later edits to the comment leave it. The upgrade that brought the two texts
moved every older entry's comment, typed notes included, to its source
narration.

`GET /api/comment-writer/status` says whether the writer is running and how
many texts it has left or gave up on; `POST /api/comment-writer/run` (body
`{}`) retries those.

## Import presets

An import preset says, for each statement the importer reads, which account
it goes to and which instructions categorise it. They are kept in the app,
one institution per row ("Sample Bank"), and change only through one
endpoint. There is no file to edit.

```json
{
  "id": 1,
  "name": "Sample Bank",
  "parsers": ["sample-bank-xls", "sample-bank-pdf"],
  "accounts": [
    {
      "account_id": 12,
      "name": "Sample Savings",
      "is_credit_card": false,
      "account_identifiers": ["0505050000123"],
      "custom_mappings_filenames": ["custom_mappings_default.prompt"]
    }
  ]
}
```

- `parsers` are saved parsers' directory names. A parser belongs to the one
  institution that lists it.
- An account names its ledger account by `account_id`. `name` is what the
  everyday screens call it. `is_credit_card` is always given.
- `account_identifiers` are the numbers its statements print, digits and
  uppercase `X`, no spaces. A statement goes to the account that lists the
  identifier it printed. An institution with one account may list none, and
  then every statement its parsers read goes to that account.
- `custom_mappings_filenames` are files directly in `user-config/`, joined in
  this order for the AI. Many accounts may list the same file.

**Reading them:** `npx sapporta api get /api/import-presets`. Each account also
carries `ledger_account_name`, which is null when its ledger account was
deleted. `npx sapporta api get /api/import-presets/accounts/<account_id>/instructions`
returns one account's files, each with its content (null when missing), and
`text`, what the AI gets from them. Settings → Automatic transaction
categorization rules (`/categorization-rules`) shows the same to the user.

**Finding an account's id:**
`npx sapporta rows list accounts --where '{"name":{"eq":"…"}}'`.

**Changing them:**
`npx sapporta api post /api/import-presets/changes --body '{"changes":[…]}'`.
The changes are applied in order, and the batch is written whole or not at
all: after it, the whole table must keep the rules below. Institutions are
named by `name`, accounts by `account_id`. The reply is the presets, as the
GET returns them. Each kind of change:

```json
{"kind":"add_institution","name":"Sample Bank","parsers":["sample-bank-xls"]}
{"kind":"rename_institution","institution":"Sample Bank","new_name":"Sample Bank Ltd"}
{"kind":"remove_institution","institution":"Sample Bank"}
{"kind":"add_parser","institution":"Sample Bank","parser":"sample-bank-pdf"}
{"kind":"remove_parser","institution":"Sample Bank","parser":"sample-bank-pdf"}
{"kind":"add_account","institution":"Sample Bank","account_id":12,"name":"Sample Savings","is_credit_card":false,"account_identifiers":["0505050000123"],"custom_mappings_filenames":["custom_mappings_default.prompt"]}
{"kind":"update_account","account_id":12,"custom_mappings_filenames":["custom_mappings_personal.prompt","custom_mappings_default.prompt"]}
{"kind":"remove_account","account_id":12}
```

`update_account` takes any of `name`, `is_credit_card`,
`account_identifiers` and `custom_mappings_filenames`, and replaces each list
it is given whole: to reorder the instruction files, send them in the new
order; to add an identifier, send the account's whole list with it. Show the
user the change in their words and wait for a yes, as for any other change.

**Refusals** are a 422 with `error`, `code` and `change_index`, the change the
refusal is about (null when it is the table the whole batch leaves):

| `code`                                                        | What to do                                                                                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `unknown_institution`, `unknown_account`, `parser_not_listed` | The change names what the presets don't hold at that point in the batch. Read them again and name what is there.                          |
| `institution_has_accounts`                                    | Remove the institution's accounts first, in the same batch.                                                                               |
| `institution_name_empty`, `institution_name_taken`            | Give the institution a name no other has.                                                                                                 |
| `parser_listed_twice`, `parser_in_two_institutions`           | A parser is listed once, by one institution. Remove it from the other first.                                                              |
| `account_listed_twice`                                        | An account is in one institution once. To move it, `remove_account` then `add_account`.                                                   |
| `account_name_empty`, `account_name_taken`                    | Give the account a name no other preset account has.                                                                                      |
| `identifier_on_two_accounts`                                  | Two accounts of one institution list the same identifier; one of them is wrong.                                                           |
| `account_identifier_required`                                 | An institution with more than one account needs every account's identifier, so a statement can be told apart. Add them in the same batch. |
| `mapping_file_listed_twice`                                   | List each instruction file once per account.                                                                                              |
| `unknown_ledger_account`                                      | No ledger account has that id. Look it up again, or create the account first.                                                             |
| `unknown_parser`                                              | No saved parser has that name, in the project's `custom-built-parsers/` or dbu6's (`npx dbu6 docs parsers`).                       |

An instruction file may be listed before it exists; `npx dbu6 check` names
the missing ones, and the ones a deleted account leaves behind.

**An old `user-config/import-presets.json`:** presets used to live in that
file. Upgrading moves them into the database by itself: the migration that
does it writes them for the user whose accounts have every `base_account` the
file names, reads them back, and deletes the file once the migrated database
is in place. Presets that shared a parser or an account became one
institution, named after the first; the presets of one account became one
account, with every identifier and instruction file they had.

When it can't (a `base_account` no account has, one account's presets
disagreeing on `is_credit_card`, a parser that isn't saved, more than one user
it could belong to), it keeps the file, `dbu6 migrate` prints why, and
`npx dbu6 check` fails on the file. Fix what it named in the file, then:

1. `npx sapporta api post /api/import-presets/import-json --body '{"apply":false}'`
   proposes the institutions and changes nothing. Show the user the proposal
   and its `warnings`.
2. With their yes, `--body '{"apply":true}'` writes them, reads them back and
   deletes the file. It refuses when the presets already hold institutions
   (`presets_already_in_table`; the file is left over, so delete it once the
   presets are right), when a `base_account` names no ledger account
   (`unresolved_base_accounts`, with the `names`), and when one account's
   presets disagree on `is_credit_card` (`conflicting_is_credit_card`); the
   file is kept after any refusal.

## Reaching the app

- **The CLI is already here.** dbu6 ships the `sapporta` command (its own bin
  forwards to `@sapporta/server`, which dbu6 depends on), so run it as
  `npx sapporta …` from the project and install nothing. Every command in this
  file is spelled that way: `npx` runs this project's own
  `node_modules/.bin/sapporta`, which is dbu6's bin. Nothing has to be
  prefixed onto a command and no environment needs setting by hand:
  - The CLI finds the app by itself: it calls `http://localhost:<port>`, with
    the port from `SAPPORTA_API_PORT` in the environment, else in the
    project's `.env.development` — the same rule `npx dbu6 dev` binds by.
    `SAPPORTA_API_URL`, when set, overrides that; leave it unset unless it
    points somewhere else on purpose.
  - dbu6's bin adds `SAPPORTA_API_TOKEN` from `.env.agent` when the
    environment has none, and changes nothing else.
  - If `npx` says the package was not found and will be installed, stop: this
    project has no link to dbu6's bin, and what would run instead is the
    standalone `sapporta` CLI from npm, which reaches the app without the
    token. `npx dbu6 check` names the missing link; upgrading or reinstalling
    dbu6 (`npx dbu6 upgrade`) restores it.
  - Without that link `npx` also runs a `sapporta` installed globally, and a
    bare `sapporta` always does. Either is a plain Sapporta CLI that sends no
    token, and an old one may call port 3000, so never write these commands
    without `npx`.
- **The token** must be in the environment as `SAPPORTA_API_TOKEN`.
  - `npx dbu6 agent env` gives this project one: it mints a token, writes it to
    the gitignored `.env.agent`, and revokes the one its previous run wrote.
    It names the account it used, and refuses a project that holds only the
    sample account `dbu6 seed` makes.
  - dbu6's `sapporta` reads that file by itself. Anything else — a plain
    Sapporta CLI, or the `curl` uploads below — does not, so put the token in
    its environment first: `set -a; . ./.env.agent; set +a`. A CLI that
    answers "No API token sent" needs exactly that.
  - The file holds only the token. One an older dbu6 wrote also holds a
    `SAPPORTA_API_URL`, which dbu6's bin ignores but loading the file into a
    shell does not: run `npx dbu6 agent env` again to rewrite it.
  - A person can instead create one in the app, at
    `<app URL>/account/profile?token=new`, and choose **Copy prompt**.
  - Never put the token in a tracked file or show it in the chat.
- **Check access** with `npx sapporta api get /api/auth-context`, which names
  the user and workspace the token acts as.
- **If you are blocked,** say so in one plain sentence. Meanwhile, answer what
  you can from SQLite.
  - `APP_SERVER_UNREACHABLE`: look at `target.apiUrl` in the error. If the
    port is right, dbu6 isn't running: ask the user to start it (`npx dbu6
dev` in the project), or offer to.
    In a sandbox, ask for network access.
  - `unauthenticated`, `token_expired` or `token_revoked`: run
    `npx dbu6 agent env`, then check again. If that is not yours to run, ask the
    user for a token (`<app URL>/account/profile?token=new`); when they paste
    the prompt that carries it, store only its token, as above. The CLI is
    already installed and this file records the command, so skip the prompt's
    install steps — but not its skill step: if it asks for the Sapporta skill
    and you do not have it, install it as the project's `AGENTS.md` says.
- **Tables:** `npx sapporta rows list <table> --where '{"col":{"eq":1}}' --sort date,id --limit 1000 --q <words>`.
  The other commands are `npx sapporta rows count`, `npx sapporta rows get`,
  `npx sapporta rows create`, `npx sapporta rows update <table> <id> --values '{…}'`
  and `npx sapporta rows delete`. Add `--output json` to parse the output.
- **Endpoints:** `npx sapporta api get <path> --query '{…}'`,
  `npx sapporta api post <path> --body '{…}'`.
- **Uploads** need curl, with the token in the environment as above. The app is
  at `http://localhost:<port>`, the port being `SAPPORTA_API_PORT` from the
  environment, else from `.env.development`:
  `curl -sS -H "Authorization: Bearer $SAPPORTA_API_TOKEN" "http://localhost:<port>/api/import-draft/statements/auto" -F "files=@<path>"`.

### Reading the database

The owner allows reading SQLite directly for diagnosis:
`sqlite3 -readonly -header -column data/sqlite.db "…"`.

- `data/` is under the project root, unless `SAPPORTA_DATA_DIR` in the
  project's env file says otherwise.
- `accounts` is the chart of accounts; `account` is sign-in data.
- The file can hold more than one user's books, for example a seeded demo
  user. If `SELECT COUNT(DISTINCT scoped_to_user_id) FROM accounts` is above 1,
  filter every table by the owner's `scoped_to_user_id` (`user.id` for their
  email).

## The data

| Table                    | Holds                                                                                                                                              | Columns that matter                                                                                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts`               | The chart of accounts, one tree                                                                                                                    | `name` (unique), `parent_id`, `account_type`: Asset, Liability, Equity, Revenue or Expense                                                                                                                     |
| `draft_transactions`     | Imported rows waiting in Review                                                                                                                    | `base_account_id`, `account_id` (the categorized account; null when uncategorised), `date`, `source_narration`, `comment`, `withdrawal`, `deposit`, `balance_assertion_base_account`, `source_transaction_key` |
| `journals`               | Transactions in the books                                                                                                                          | `date`, `description` (an imported row's comment, else its source narration; `Expenses` or `Deposits` on older imports)                                                                                        |
| `journal_entries`        | A journal's lines                                                                                                                                  | `journal_id`, `account_id`, `debit`, `credit`, `account_balance_assertion`, `comment`, `source_narration`, `source_transaction_key`                                                                            |
| `import_presets`         | The import presets, one institution per row; read only, change them through `/api/import-presets/changes`                                          | `name`, `parsers` and `accounts` (JSON; see [Import presets](#import-presets))                                                                                                                                 |
| `categorization_rule_requests` | The rule requests the user made in Review, waiting to become a rule or guidance; read only, change them through `/api/categorization-rule-requests` | `base_account_id`, `account_id` (where the drafts go), `transactions` (JSON: each draft's `date`, `source_narration`, `direction`, `amount`), `note`                                                           |

- Amounts are rupees, stored as REAL. In the tables, a balance is
  debit − credit, so money held is positive, and money owed and income are
  negative. A statement balance uses the same sign.
- A draft's `withdrawal` and `deposit` are both positive.
- Adding drafts to the books makes one journal per draft, described by its
  comment, else its source narration, as they were then:
  - One entry on its categorized account, carrying the source narration, the
    comment and `source_transaction_key`.
  - One entry on the statement's account, with no key. The day's last one
    carries the day's closing statement balance.
- Journals added before 2026-09-24 group a run of same-day, same-direction
  drafts: one categorized account's entry per draft as above, and one entry on the
  statement's account for the run's total, carrying the run's last statement
  balance. Their description is `Expenses` or `Deposits`.
- Reports show amounts the way people read them, not the way the tables store
  them:
  - The Balance Sheet and Trial Balance show liabilities as positive.
  - In `income-expenses`, income and spending are both positive.
- Grid reports return rows in `nodes[].columns`, nested rows in
  `nodes[].children`, and totals in `footerRows`.
- In tree reports (Expense Breakdown, Balance Sheet, Trial Balance, Income
  Statement), each account's row already includes its sub-accounts, so don't
  add rows up. Section totals are in `rollup`.
- A Balance Sheet section keeps its account type in `account_type`; `section`
  is only its label. Equity has no `rollup`: its total is net worth (assets
  less liabilities), the `net-worth` footer row. Equity includes a computed
  row, income less spending to date, with no `account_id`. A second footer
  row, `out-of-balance`, appears only when the books are out, holding the
  difference.
- The account tree comes from `parent_id`, and report sections come from
  `account_type`, never from a name.
