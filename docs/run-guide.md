# Doing the books from a pile of statements

Most often the user has dropped their bank and card statements, any bank,
any period, in any order, and asked you to do their books. In one session you work out
which statements belong to which account, set up what is missing, import,
categorize, settle duplicates and balance checks, and stop with every
account ready to add. The user's only real input is their answers to what
you couldn't settle, in one round.

**The only entries you write to the books are opening balances:** those
the statements give, as you add their accounts, and those the user gives
you for [accounts with no statements](#accounts-with-no-statements). The
drafts are the user's to add, as AGENTS.md says.

Read `npx dbu6 docs books` first: how to reach the app, the words to use
("Talking to the user"), the endpoints. This guide orders the work, says
what the user's go-ahead covers, and how to ask. The method for each problem
is in a playbook: `npx dbu6 docs playbook <name>`, listed by
`npx dbu6 docs playbook`.

## Talking to someone new

On a first run the user knows nothing of how dbu6 works: not drafts, not
the chart, not parsers or balance checks. All they see of the run is three
messages from you, and each has to make sense on its own, from their own
statements:

| Message                       | Phase                 | What it gives them                                                                    |
| ----------------------------- | --------------------- | ------------------------------------------------------------------------------------- |
| 1. What you gave me           | 2, the plan gate      | what their statements are, what you will do, the little you need before starting     |
| 2. What your money looks like | 8, the question round | what their transactions show, the categories fitted to that, what you couldn't settle |
| 3. What to do now             | 9, the report         | where their books wait, what is left for them, everything you changed                 |

Between them, only progress lines (see [Phases](#phases)).

- **Explain a thing the first time it matters, in one sentence, with their
  own data.** Never ahead of time, and never twice:

  | When it first comes up                 | Say, once                                                                                                                        |
  | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
  | Message 1 of a first run               | "Everything I import waits in Review. Your books change only when you add it there."                                            |
  | Message 1 of a first run               | "Your statements stay on this computer, except what is sent to the AI model doing this work."                                   |
  | a statement format no parser reads     | "dbu6 can't read Sample Bank's statements yet. I'll teach it once; later statements in that format read on their own."          |
  | the chart                              | "Your categories, and what you own and owe, are the accounts in your books."                                                     |
  | a card's opening balance               | "Your first card statement starts with what you already owed. It's 'Previous balance' at the top of the April statement."        |
  | a failing balance check                | "On 14 Jul the statement says 52,000; the transactions add up to 47,000."                                                        |
  | a transfer between their own accounts  | "50,000 left savings and reached your card on 3 Jun: that is paying the card bill, not spending."                               |
  | accounts with no statements            | "Cash, deposits and loans have no statement, so their balance is what you tell me you held or owed when the books start."        |

- **Leave out how dbu6 works inside:** parsers, presets, phases,
  playbooks, refusal codes, endpoints, paths in the project. Say what it
  means for them: "I taught dbu6 to read Sample Bank's statements", not
  "I wrote a parser".
- **Every question says why you ask, where to find the answer, and what
  skipping it does.**
- **Show evidence, not conclusions alone:** counts, totals and a few real
  descriptions, so the user can catch a wrong guess.
- **Keep each message to a screen** where it can be: Message 1 about 30
  lines; Message 2 pages its questions, as [Questions](#questions) says.
- Outside a first run the user has seen this before: drop the one-sentence
  explanations, keep the shape.

## Entries

A run starts from one of these. The prompt says which; a request in the
user's own words fits one of them.

| The run starts from                                 | Follow                                                      |
| --------------------------------------------------- | ----------------------------------------------------------- |
| a pile of new statements, in the inbox or a folder  | [Phases](#phases), from 0                                   |
| the drafts already in Review, no new files          | [Starting from the drafts](#starting-from-the-drafts)       |
| a balance check in the books that stopped matching  | `npx dbu6 docs playbook posted-balance-check`               |
| a change to the chart: rename, move, merge or split | `npx dbu6 docs playbook chart-change`                       |
| cash, deposits, investments or loans: no statements | [Accounts with no statements](#accounts-with-no-statements) |

Each one waits for the user's yes before it writes anything. A section of
this guide starts with the preflight (phase 0) and shows its plan; the two
playbooks keep their own plan and permissions: every change they make is to
entries in the books.

## Where the statements are

- **From the app:** the prompt names the statement inbox.
  `npx sapporta api get /api/statement-inbox` lists every batch waiting, with
  each file's `saved_path` and size. The files were only saved: nothing has
  read or imported them. Send them to the app by path, one
  `-F "inbox_files=<saved_path>"` each, in place of `-F "files=@<path>"`:
  they are read where they are. An import deletes its files from the inbox
  once their rows are in the drafts, and its reply lists them
  (`inbox_files_imported`); a read, or an import that refuses, leaves them.
  So what is left there is what didn't go in, and you never delete a file
  yourself. When the user doesn't want a file imported, discard it:
  `npx sapporta api post /api/statement-inbox/discard --body '{"saved_path":"<saved_path>"}'`.
- **From the user's words:** a folder they named ("my statements are in
  ~/Downloads/bank"). Read the files from there; don't copy them into the
  project.

## Phases

Between the three messages, say what you are doing in one plain line as a
step starts or ends, in counts and the user's words: "Learning how Sample
Bank lays out its statements", "Imported Sample savings: 412 transactions,
380 already sorted". No phase numbers, playbook names or endpoints.
Phases 0–2 only read; nothing is written before the user's go-ahead.

### 0. Preflight

- `npx sapporta api get /api/auth-context` names the user the token acts as.
- `npx dbu6 check` reports the project's health.
- If the app is down or the token fails, say so in one plain sentence, as
  "If you are blocked" in the books guide says, and stop.

### 1. Survey

- One `POST /api/add-account/read` over every file at once (curl, as
  "Uploads" in the books guide shows, each file as above). It writes nothing
  to the books. It groups the files by account (`accounts`,
  each with its `status`: `new`, `empty` or `in_books`), and names the files
  no parser reads (`unrecognized`) or several do (`ambiguous`).
- `npx sapporta api get /api/home`: what each account in the books holds,
  and its last statement balance.
- `npx sapporta api get /api/import-presets`: the banks and cards set up.
- `npx sapporta rows count accounts`: whether the books have a chart.
- `npx sapporta api get /api/overview`: `{"posted": false}` means nothing
  beyond opening balances is in the books yet. That, or books with no
  chart, makes this a first run, whose question round also asks about the
  [accounts with no statements](#accounts-with-no-statements).

Build one table for yourself, a row per account, the files no parser reads
on a row of their own. The user sees it in their words, in Message 1:

```
Account            Files  From        To          State      Needs
Sample savings       4    2025-04-01  2025-09-30  new        -
Sample card          6    2025-04-05  2025-10-04  new        opening balance (you)
Sample current       2    2025-07-01  2025-08-31  in books   2025-06 missing (download)
(unknown)            1    -           -           no parser  parser
Sample wallet        1    2025-08-02  2025-08-29  text       account, opening and closing (you)
```

Note under it: files read by several parsers, files of two accounts, a
statement whose period the books already hold, and a period with a gap
between two files. Import such a statement with the rest of its account's
files all the same: rows the books hold are skipped, and the import deletes
the file from the inbox.

### 2. Plan gate: Message 1, what you gave me

Your first reply, and you wait for go:

```
I read 13 files. They are these accounts:

  Sample savings      savings account   Apr–Sep 2025   4 statements
  Sample card         credit card       Apr–Oct 2025   6 statements
  Sample current      current account   Jul–Aug 2025   2 statements
  Sample wallet       rows you copied   Aug 2025       31 transactions
  sample-export.pdf   a statement dbu6 can't read yet

  Sample current has no June statement. Download it from net banking
  and drop it on Update, now or later.

How this works: I'll import every transaction, sort each into a
category, and ask you about the ones I can't tell, all at once.
Everything waits in Review; your books change only when you add it
there. Your statements stay on this computer, except what is sent to
the AI model doing this work.

On your yes I'll
  - start you on a standard set of categories, and fit it to your
    spending once I've read it
  - teach dbu6 to read sample-export.pdf's format, then see whose it is
  - import all of it

Before I start
  1  Sample card: what did you owe on 5 Apr 2025? It's "Previous
     balance" at the top of the April statement. Skip it, and the
     card waits until you tell me.
  2  Sample wallet: which account is it, and is it a card? What was
     its balance on 2 Aug and on 29 Aug? Skip it, and I leave it out.

This will take a while, most of it learning the new format. You can
leave it running. Go ahead?
```

- **The accounts** by name, kind, months and what they hold, never by
  dbu6's states (`new`, `in_books`). Under them, what the user can act
  on: a missing month, with where to get it; a statement already in the
  books; a file holding two accounts.
- **"How this works"** only on a first run. On a later run, one line on
  what is already in the books instead: "Sample savings is in your books
  up to Sep 2025."
- **"On your yes I'll"** is what the go-ahead covers, in their words, a
  line per kind of work. When the books have no chart, say you start
  them on a standard set and fit it once you have read their
  transactions. Don't show the chart: a tree of categories means nothing
  before they have seen their own transactions. Message 2 shows it,
  fitted.
- **"Before I start"** holds only what blocks an import, numbered, each
  with where the answer is and what skipping does: a bank's name when a
  file doesn't say; a card's opening balance when the read says
  `needs_opening`; the group a new bank or card goes under when
  `default_parents` of
  `npx sapporta api get /api/setup/statement-accounts` is `null` and the
  books have a chart (with none, phase 3 settles it); and for each text
  file to import freeform ([Text files](#text-files)) what it doesn't
  say: which account, whether it is a card, and the opening and closing
  balances. Everything else waits for Message 2.
- **How long,** roughly, from what is ahead: learning a format takes the
  longest. Then "Go ahead?"

### 3. Chart

When the books had none: `npx sapporta api get /api/setup/chart-of-accounts`
gives `starter` and `unticked` (accounts many households have no use for).
`POST /api/setup/chart-of-accounts` with the starter less the unticked ones
and everything under them. It is a starting point, there so the imports and
the categorizer have accounts to sort into; you fit it to the user in
phase 6, and they see it in Message 2. On this chart a new bank account
goes under Bank Accounts and a card under Credit Cards: pass that
`parent_id` in phase 5, and don't ask.

### 4. Parsers

For each file no parser reads, or several do: the `unrecognized-statement`
or `ambiguous-parsers` playbook, then `npx dbu6 check`, then read the files
again. A text file no parser reads is the exception: it is imported
freeform, as [Text files](#text-files) says, with no parser. A parser
serves every account of that format, so do this once per format, before
any import. A bank or card the run adds gets no preset account from you:
`add-account/add` sets it up.

### 5. Accounts and imports

Per account, oldest statement first:

- `new`: `POST /api/add-account/add` with its files, `name`, and
  `parent_id`, `institution`, `kind` and `opening_amount` where the read
  asked for them (the books guide, "I opened a new account or card").
- `empty`: `POST /api/add-account/add`, with `opening_amount` when asked.
- `in_books`: `POST /api/import-draft/statements/auto` with its files.

A refusal, or a file the import leaves `unresolved`, has a playbook:
`npx dbu6 docs playbook` lists them by what went wrong, and each one's
"When" names the codes it covers.

A missing period goes on the "download" list, and the account is imported
up to the gap, if its earlier files import on their own. Then move on to the
next account rather than stopping.

### Text files

A `.txt` file, or any file of rows copied out of a PDF, a web page or an
app, goes through the survey like any statement: a saved parser that reads
it imports it as above. When none does (`unrecognized`), don't write a
parser for it; import it freeform, as `npx dbu6 docs freeform-guide` says:

- Read its transactions in the survey, and give it a row in the table, with
  its count and dates and `text` as its state.
- What the file doesn't say goes in the plan's questions, so the user
  answers it with the go-ahead: the account it belongs to (one in the books,
  or a new one with its name, type and parent), whether it is a card, and
  the opening and closing balances. A balance the file shows is offered as
  a suggestion to confirm, never used on its own.
- After go, create a new account with
  `npx sapporta rows create accounts`, then `POST /api/import-draft/abacus`
  in the account's turn among the imports, oldest first, naming the file
  its rows came from in `inbox_files` when it waits in the inbox: the
  import deletes it from the inbox, as any import does.
- A balance mismatch goes back to the user in the question round; never
  change rows or balances to make them agree.

### 6. Categorize, across all accounts

The import already ran the rules and the AI. What is left has no account.

1. For each account, after the rule requests you encoded: `classify` over its drafts
   with no account, with its own `custom_mappings_filenames` ("Categorise
   these" in the books guide).
2. Read what is still blank across *all* accounts together, with the
   accounts already used, as the `categorize` playbook says, and:
   - categorize a transfer between the user's own accounts, or a card
     payment, to the other account like any other row. Nothing is settled
     here. A row going to an account whose statement is in the same upload
     is that statement's row too, so expect it to fail a balance check in
     clean-up, and look for it there;
   - group the rest by what they are, by judgment;
   - sort each group into "sure" and "needs your call".
3. Read what the user's money looks like, over every draft of the run,
   sorted or not, for the top of Message 2: money in by source, what
   comes regularly (the same payee most months) with its usual amount;
   money out by account, largest first; money moving between their own
   accounts; and how much is still unsorted.
4. Fit the chart, when this run created it (phase 3):
   - a group no account fits gets a new account, proposed under
     "Accounts I'll create";
   - an unticked starter account the transactions call for (Stocks for
     dividends, Children for school fees) is a new account like any
     other;
   - starter accounts nothing uses stay. The user may name ones to drop;
     never propose removing one yourself: a category unused in these
     months is often next year's.

   On books whose chart the user already had, only add. Renaming,
   merging or moving their accounts is the `chart-change` playbook, on
   their word.

Count and group with SQL (`sqlite3 -readonly`, as "Reading the database" in
the books guide allows); never list every draft into your context. Read rows
only for the groups you must judge. For example, what is blank per account:

```sql
SELECT a.name, COUNT(*) AS blank, ROUND(SUM(d.withdrawal + d.deposit)) AS total
FROM draft_transactions d JOIN accounts a ON a.id = d.base_account_id
WHERE d.account_id IS NULL
GROUP BY a.name ORDER BY total DESC;
```

And where the money went, for Message 2:

```sql
SELECT a.name, a.account_type, COUNT(*) AS n,
       ROUND(SUM(d.withdrawal)) AS money_out, ROUND(SUM(d.deposit)) AS money_in
FROM draft_transactions d JOIN accounts a ON a.id = d.account_id
GROUP BY a.id ORDER BY money_out + money_in DESC;
```

### 7. Clean-up

With the "sure" groups set, per account
(`npx sapporta api get /api/review/accounts/<id>`): duplicates (`duplicates`
playbook), then balance checks (`balance-checks` playbook). Fix what the
evidence settles, such as an exact duplicate draft of the same statement
row.

Where checks fail by amounts that transfers or card payments between the
user's accounts could explain, fixing that is its own bounded task, started
only now that every statement is imported and categorized: the
`double-counted-transfers` playbook, given to a subagent with a narrow
brief (the accounts with failing checks, the playbook, and its Report
headings), or done as its own step without one. It deletes second copies
and blanks the checks the playbook allows, without asking, and asks only
what the playbook says to. Its report and questions join the question
round.

What clean-up doesn't settle joins the question round.

### 8. Question round: Message 2, what your money looks like

One message, as [Questions](#questions) says: what the money looks like,
the categories, then the questions, the clean-up's among them. Then:

- each answer sets its drafts by hand (`/api/draft-transactions/set-account`);
- each rule or prompt line the user said yes to is written ("Always put this
  under X" in the books guide); one with no yes is not;
- each new account the user approved is created with its name, type and
  parent in one call:
  `npx sapporta rows create accounts --values '{"name":"…","account_type":"…","parent_id":<id>}'`;
- each opening balance the user gave is posted, as [Accounts with no
  statements](#accounts-with-no-statements) says;
- then, when you wrote a rule, `classify` again over what is still blank;
  and the clean-up again
  over the accounts the answers touched.

There is no second round: what the answers left open goes in the report,
under "Still open".

### 9. Report: Message 3, what to do now

[The report](#the-report), then stop. Files still in the inbox go under
"Still open", each with why it didn't go in.

## Starting from the drafts

No new files: the statements are already imported, and their drafts wait in
Review. The prompt from Review starts here, or the user asked you to finish
what is left there. The work is the second half of a run, across every
account with drafts at once, or across the accounts the prompt names: then
the survey, the plan and the work cover only those, and you read another
account only to fix a transfer counted twice with it.

### 0. Preflight

As in [Phases](#phases).

### 1. Survey

- `npx sapporta api get /api/review/accounts`: each account with drafts,
  with `drafts`, `uncategorised`, `duplicates`, `failing_checks`,
  `relies_on` (the accounts whose drafts its balance checks count, so it
  goes into the books with them) and `rule_requests` (how many rule
  requests the user left on it); and `add_all`, the accounts Review's Add
  all would add.
- For each account with `rule_requests` above 0:
  `npx sapporta api get /api/categorization-rule-requests --query '{"base_account_id":<id>}'`.
- `npx sapporta api get /api/statement-inbox`: files dropped and not yet
  imported. Name them in the plan; don't import them unless the user says
  so. If they do, those files are a pile: run [Phases](#phases) for them
  before categorizing.

### 2. Plan gate

Your first reply is the plan, and you wait for go:

1. One row per account with drafts, what is left on it:

   ```
                    Waiting  No category  Your rule   Possible    Days off the  Waits on
   Account                                requests    duplicates  statement
   Sample savings       412           34          2           2             0  -
   Sample card          188           17          0           0             3  Sample savings
   ```

2. For each rule request, the rule or prompt line you propose, as the
   `rule-requests` playbook says, or why it can't be one.
3. The files waiting in the inbox, by name, with "I'll leave these unless
   you say."
4. The questions you already know you have, numbered.
5. One line: "Go ahead?"

### 3. Categorize

Skip the chart, parsers and imports (phases 3 to 5). Encode the rule
requests first, as the `rule-requests` playbook says: they are the user's
answers, given in Review. Then phase 6 over every account in the plan:
`classify` over what is blank, which now meets the new rules, then what is
still blank, judged across all accounts.

### 4. Clean-up, question round, report

Phases 7, 8 and 9, as for a pile. A rule request you couldn't encode goes
in the report under "Still open"; it stays on the user's list.

## Accounts with no statements

Cash, fixed deposits, investments, loans given and loans taken have no
statement, so no import sets their balance. An opening balance on the day
the books start does. Without one, the balance sheet leaves them out.

**When.** On a first run (see the survey), the question round asks about
them, as one more block. Outside a first run, only when the user asks, or
the prompt names this section: then, after the preflight, the block below is
the whole plan, and you post on the user's answer.

**Read.** `npx sapporta api get /api/opening-balances`: the accounts in
`section` `own` (assets) and `owe` (liabilities) with `opening` `null` are
the ones to ask about. A bank or card (`statement`) is not: its first
statement set its balance. `default_date` is the date to use: the day
before the account's first activity, else the day the books start. When
it is `null` (no opening entry in the books at all), use the day before the
earliest statement in the run.

**Ask,** in the question round, after the other blocks:

```
Cash, deposits and loans have no statement, so their balance is
what you held or owed on 2025-03-31, the day your books start
  6  Cash in hand                held   amount?
  7  Fixed deposits              held   amount?
  8  Car loan                    owed   amount?
  9  Anything else you hold or owe: its name, held or owed, and the amount
```

- One row per account, in the order the chart lists them, what is held
  first. A group with nothing under it is asked as "anything under it?".
- Amounts are given as positive numbers: what was held, or what was owed.
- `6 5000 8 250000` answers rows; `skip` or no answer leaves a row out.
- A new one (row 9) is an account to create, with its type and a parent
  you propose from the chart: put it under "Accounts I'll create".

**On a yes:**

1. An account the chart lacks:
   `npx sapporta rows create accounts --values '{"name":"…","account_type":"Asset","parent_id":<id>}'`
   (`Liability` for one owed), the parent an Asset or Liability account
   the user agreed to.
2. Its opening balance:
   `npx sapporta api post /api/opening-balances --body '{"account_id":<id>,"date":"YYYY-MM-DD","amount":<signed>}'`,
   positive when held, negative when owed. The date must be before the
   account's first activity; a refusal (`date_not_before_first_activity`)
   names that date.

The amount is the user's. Never guess one, or take it from a description.

**Report.** In a run, the "Opening balances" and "Skipped" lines of [the
report](#the-report). Started from this section, those two lines are the
whole report.
Changing an opening balance already recorded is asked on its own
(`PUT /api/opening-balances/<account id>`, the books guide's "Opening
balance").

## Questions

Message 2. It opens with what the user's money looks like, so they answer
the questions knowing what you saw; then the questions.

Ask only what you can't settle from the books, the rules and the
descriptions: a group with two plausible accounts, a payee never seen, a
transfer whose other side is in no statement, a new account you want. A
group you are sure of is stated, not asked.

On a first run it opens with two blocks that ask nothing:

```
Here's what your statements show, Apr–Sep 2025. None of it is in your
books yet.

Money in                                          Count      Total
  Gross Pay, from Sample Employer   monthly 1,20,000   6   7,20,000
  Savings Interest                  quarterly          2      1,600

Money out, largest first
  Rent                              monthly 30,000     6   1,80,000
  Home loan (new)                   monthly 25,000     6   1,50,000
  Groceries                                           58     48,000
  Food Delivery                                       42     18,400
  Other, 14 categories                               120     96,000
  Not sorted yet, questions below                     26     77,000

Between your own accounts
  Card bills paid from Sample savings                  6   2,10,000

Your categories
  I started you on a standard set and fitted it to the above: added
  Home loan under Loans (see 5). 64 more standard ones wait unused,
  such as Insurance and Travel; they're there when you need them.
  To rename, merge or drop any, say so.
```

- Money in and out by the accounts the drafts went to, as the run read
  them (phase 6), largest first, with "monthly" and the usual amount
  where a payee recurs. Past about 8 lines, the rest as one "Other" line.
- Accounts the run created are named where they first show; the unused
  standard ones get a count and a couple of names, never a tree.
- On a later run, or [Starting from the drafts](#starting-from-the-drafts),
  skip both blocks: the user knows their books.

Then three blocks, numbered across the whole message, and on a first run a
fourth: what the user held or owed ([Accounts with no
statements](#accounts-with-no-statements)).

```
Doing these unless you say otherwise
  1  Sample food app (42 · 18,400)            → Eating out
  2  Sample card payment (6 · 2,10,000)       → Sample card   transfer, both statements

Need your call
  3  UPI sample-payee-050505 (9 · 27,000)     Jun–Sep, monthly 3,000
       a) Rent   b) Household help   c) Loans given   d) something else   e) skip
  4  NEFT NOPII CUSTOMER NAME (1 · 50,000)    2025-07-14
       a) Gifts given   b) Loans given   c) something else   e) skip

Accounts I'll create
  5  Household help  under Household   (for 3b, if you pick it)

Rules for next time, only the ones you say yes to
  6  out, contains "SAMPLEFOOD", 100–1,000   → Eating out   catches nothing else
```

- Counts and totals in aligned columns, amounts with Indian digit grouping;
  for anything asked, a few descriptions with dates and amounts.
- 2–4 options, likeliest first, plus "something else" and "skip".
- New accounts with their parent and what needs them, so the same reply
  approves them.
- Each rule or prompt line you'd add is its own numbered line under "Rules
  for next time", with what else in the books it would catch. An answer to
  a group, or `ok`, sets those drafts and adds no rule ("A rule needs its
  own yes" in the books guide).
- Ordered by total, largest first, so the user can answer the top and skip
  the rest. Past about 25 groups, say how many there are and offer them in
  pages of that size.
- The user may reply in shorthand: `ok` accepts the first block; `3b 4a`;
  `5 no`; `6 yes`; `rest skip`. Free text is fine too. Say so in the message's last line, in
  those words, so they know they can.
- A rename, merge or drop of a category they ask for in their reply is
  the `chart-change` playbook's, applied to drafts only, with no plan of
  its own: their reply is the yes.

## The report

It opens with one link, to Review, where every account below waits to be
added: `SAPPORTA_PUBLIC_APP_URL` from `.env.development`, then `/review`,
written out in full so the terminal makes it clickable. Name no other
Review link; Review lists the accounts.

Message 3. It says what to do now before what was done: the user reads
the top and acts.

```
Your books are ready to review: http://localhost:<port>/review

What to do now
  1  Open Review and add the ready accounts to your books.
     Sample savings and Sample card go in together: the card bills
     tie them.
  2  Sample current: 7 transactions need a category. Set them in its
     Drafts tab, then add it.
  3  Download Sample current's June 2025 statement and drop it on
     Update.

Ready to add        Transactions  Sorted by you  Matches the statement
Sample savings               412             34  every day (31)
Sample card                  188             17  every day (6)

Not ready           Why
Sample current      7 transactions with no category
Sample wallet       waits on Sample current (a transfer ties them)

What I changed
  New categories      Household help (under Household)
  New rules           contains "SAMPLEFOOD" → Eating out (42)
  Formats learned     Sample Bank savings CSV
  Duplicates removed  2 on Sample savings
  Opening balances    Cash in hand 5,000 · Car loan, you owe 2,50,000
Still open            Sample current: June 2025 missing
Skipped               Fixed deposits: no balance given
```

- "What to do now" is numbered, the user's next steps in the order they
  can take them, each in a line or two. It names no button.
- "Ready to add" counts what the user may want to check: how many
  transactions, how many they decided, whether every statement balance
  matches. How each draft was sorted (rules, AI) stays out.
- Review's Add all adds the ready accounts in one go, so name no order.
  Say which accounts go in together, since their balance checks count
  each other's drafts: Add on one of them alone is refused.
- "Not ready" lists every account with drafts that isn't ready, each with
  why, in one line: drafts without an account (the user sets them in its
  Drafts grid), a possible duplicate or a failing check you couldn't
  settle (see "Still open"), or an account it waits on that isn't
  ready. The user adds it from Review once it is.
- Every change you made is in the report: accounts, rules, parsers, preset changes, drafts
  deleted, balance checks blanked. A transfer no balance confirms yet goes
  under "Still open", with the statement that will.
- Opening balances you posted for [accounts with no
  statements](#accounts-with-no-statements) have their own line; those the
  user skipped go under "Skipped".

## Permissions inside a run

This replaces "Before changing anything" in the books guide for the run.

| Covered by the plan's go-ahead | Asked in the question round | Asked on its own | Never |
| --- | --- | --- | --- |
| the starter chart, on books with none; parsers and their tests; preset changes for accounts in the plan; adding the accounts in the plan and importing; opening balances the statements give; categorizing drafts; rules and prompt lines for the rule requests the plan lists; deleting a draft that duplicates the same statement row; deleting a transfer's second copy and blanking the balance checks the `double-counted-transfers` playbook allows | new accounts; renaming, merging or dropping a category the user names; every other rule and prompt line, each on its own yes; anything "needs your call"; opening balances of accounts with no statements | any change to a posted entry; deleting a draft for any other reason; changing an opening balance already recorded; a change to dbu6 itself (`statement_disagreement`) | changing a statement balance; deleting to pass a check; editing `node_modules/@dbu6/app`; writing SQLite |

The rest of the books guide's rules hold, deleting a draft that carries a
statement balance among them, and nothing from the user's data goes into a
tracked file.

## Stopping and starting again

There is no run state to keep. The state is the books: presets, drafts,
their accounts, the rules in `user-config/`. A new session started with the
same prompt runs the survey again and continues: an account `in_books` with
drafts goes straight to categorizing, as [Starting from the
drafts](#starting-from-the-drafts) does, and answers already given are rules or
set accounts, so they aren't asked again. Message 1 then opens with what
is already done ("Sample savings is imported and sorted; picking up at
Sample card"), so the user isn't walked through it twice. Every write is small and
self-contained (one account's add, one batch of set-account, one rules
edit), so stopping between two leaves the books consistent. Keep no log of
the run in the project: it would be another copy of the user's financial
data.

## Any agent

The guide uses only what every coding agent can run: `npx sapporta`,
`npx dbu6`, curl and `sqlite3 -readonly`. An agent with subagents may use
them for parsers and for the transfers counted twice in clean-up; nothing
here needs them.
