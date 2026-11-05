---
"@dbu6/app": minor
---

Every asset and liability account says how it starts. `GET
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
