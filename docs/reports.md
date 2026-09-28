# Reports

The Reports page groups what dbu6 ships by what it answers, and lists any
reports of your own under "Your reports".

## What ships

**Income and spending**

* *Income and Expenses* — what you spent against income, by month.
* *Expense Breakdown* — spending by expense account, largest first.
* *Monthly Summary* — income, expenses and savings rate for each month.
* *Income Statement* — income and expense totals per account, with net income.

**Balances**

* *Balance Sheet* — what you own, what you owe, and your net worth.
* *Net Worth Over Time* — assets, liabilities and net worth, month by month.
* *Trial Balance* — every account and its balance.

**Ledgers**

* *Account Ledger* — the complete statement of one account.
* *Day Book* — every journal and its lines, day by day.
* *Asset Inflows* — money that came in from outside your accounts.

**Checks**

* *Reconciliation Differences* and *Draft Reconciliation Differences* — where
  the ledger, or the drafts, disagree with a statement's balances.
* *Last Reconciled Balances* — the last statement posted for each account, and
  which statements to import next.
* *Duplicate Drafts* — drafts that may repeat an entry already in the books.

## Reports of your own

A report is code in `reports/<id>/`, written the way dbu6's own reports are: a
route that computes it and a React screen that shows it, with full control of
the screen. dbu6 finds the folder, lists the report under "Your reports", and
typechecks and tests it under `npx dbu6 check`.

The Reports page has **Create a report**, which hands your coding agent the
prompt. The guide is `npx dbu6 docs reports`, with one complete worked report.

Pages and routes that are not reports go in `frontend.tsx` and
`dbu6.config.ts` (`npx dbu6 docs customizing`).

## hledger export

Posted journals can be rendered as an [hledger](https://hledger.org) journal
file from the journals table, and **All tools → Render draft hledger** previews
drafts the same way. Each account is written as its path through the account
tree, such as `Expenses:Food:Dining Out`, so the export drops into an existing
hledger setup.
