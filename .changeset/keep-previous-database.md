---
"@dbu6/app": minor
---

Each database migration, including the one in `npx dbu6 upgrade`, now stores
the database as it was in `data/previous-versions/`, in a file named by date
such as `sqlite-2026-11-08-a1b2c3.db`. dbu6 used to delete the old database
once the migrated one was verified.
