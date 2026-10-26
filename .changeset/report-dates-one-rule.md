---
"@dbu6/app": minor
---

Every report reads `from_date`, `to_date` and `as_of_date` the same way: a
real `YYYY-MM-DD` calendar day, and a period whose `from_date` is not after
its `to_date`. Trial Balance, Balance Sheet, Income Statement, Asset Inflows,
Expense Breakdown, Account Ledger (and its hledger text), Day Book, Monthly
Summary and Net Worth now answer 400 to any other date, which they used to
compare as text. Income and Expenses already did.

`@dbu6/app/server` exports the rule for a project's report contract:
`reportDateRange`, `requiredReportDateRange`, `asOfDateQuery` and `isoDate`.
The worked report in the guide uses `reportDateRange`.
