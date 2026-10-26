---
"@dbu6/app": minor
---

dbu6 now opens on Overview: one month's income, spending and savings beside
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
