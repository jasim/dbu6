---
"@dbu6/app": patch
---

The Balance Sheet and the Trial Balance read an `as_of_date` they can't read
as today; the day picker used to break on one. The report kit in
`@dbu6/app/frontend` exports `useAsOfDate()`, which keeps that day in the
URL for a report of your own.
