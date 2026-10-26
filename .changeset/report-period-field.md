---
"@dbu6/app": minor
---

Every report has one period field: All time, the presets, From/To months over
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
