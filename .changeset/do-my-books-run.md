---
"@dbu6/app": minor
---

One agent session can now do the books from a pile of statements. Drop every
statement on Update and press **Do my books**: the
files are saved under `tmp/statement-inbox/` (`/api/statement-inbox`) and
listed, each with **Remove**, and the coding agent follows
`npx dbu6 docs run`, which surveys them, writes parsers, adds the banks and
cards, imports, categorizes across accounts with
one round of questions, settles duplicates and balance checks, and stops
with every account ready to add on Review. In a run the agent never adds to
the books: the person does, account by account. Each problem's method is now a playbook (`npx dbu6 docs playbook`),
which the app's agent buttons and the run share. A project made before this
release can add the line its new `AGENTS.md` has: "When the person asks you
to do their books, or points you at their statements, follow
`npx dbu6 docs run`."

A transfer or card payment that both statements carry is now caught while
both sides are still drafts. A draft sent to another account counts on that
account's balance checks, so the transfer counted twice fails them. The
agent fixes it after every statement is imported and categorized, as the
`double-counted-transfers` playbook says: it deletes the second copy, and
blanks only the balance checks between the two dates that the transfer
explains. Because the balance checks now count those drafts, the opening
balance Settings › Opening balances suggests can change for an account with
transfers.

Adding drafts to the books counts other accounts' drafts only from the
accounts added in the same press. Accounts whose checks count each other's
drafts go in together on Review's Add all, in one transaction. Add on one of
them alone is refused with `FAILING_ASSERTIONS`, whose new `relies_on` names
the accounts it goes in with, and Review says "Waits on <account>".
`GET /api/review/accounts` answers `add_all`, the accounts Add all would
add, and each account's `relies_on`.

`/add-account/read`, `/add-account/add` and `/import-draft/statements/auto`
also take statements waiting in the inbox by path (`inbox_files`, repeated),
read where they are rather than copied, and so does `/import-draft/abacus`
(`inbox_files` in its JSON) for the file its rows were read from. An import
deletes its files from the inbox once their rows are in the drafts and lists
them in `inbox_files_imported`; for `/import-draft/statements/auto`, after an
account fails, those of the accounts imported before it. A read, or an
import that refuses, leaves them. `POST /api/statement-inbox/discard`
deletes a file the person doesn't want imported, and
`/api/statement-inbox/discard-all` every file. A path outside the inbox is
refused with `not_in_inbox`.

The first run's card, on Overview and Update while the books have no chart
or nothing imported, is now **Do my books**. Setting up by hand is a link on
it: **Set up by hand** (`/setup`), or **Add a bank or card** (`/add`) once
the chart is there.
