---
"@dbu6/app": minor
---

`GET /reports/income-expenses` no longer returns `first_month`. The page
stopped reading it when its month menus moved to `/reports/books-span`. The
Overview still returns its own `first_month`: the first month with any
income or spending, which its averages start from.
