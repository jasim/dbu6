---
"@dbu6/app": patch
---

Today is the date in the workspace's time zone everywhere. The Overview,
asked for no month, used to show the month on the server machine's clock,
which near midnight could differ from the month the screen counts; the date
over Update used the browser's zone; and a token from `dbu6 agent env` was
named with the date in UTC. All now read the workspace's zone.
