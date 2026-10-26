---
"@dbu6/app": patch
---

A report opened with dates it can't read (`?period=custom`, a lone
`from_date`, or dates that are invalid or out of order) now opens on its
default period. It used to show all time's figures while the period button
said "Pick dates".
