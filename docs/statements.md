# Importing statements

A statement comes in as a file from your bank and leaves as journal entries in
your books. The Import statements screen reads it, recognizes its layout and
account, checks its balances, and holds the rows as drafts until you post them.

## Parsers

A parser reads one statement layout and turns it into the rows and balances
dbu6 works with. dbu6 ships parsers for the layouts it already knows, all
Indian banks and cards: Standard Chartered bank statements (PDF and CSV) and
credit card statements (PDF), HDFC credit card statements (XLS and CSV) and
bank statements (XLS), and Federal Bank statements (XLS).

A parser of your own goes in your folder's `custom-built-parsers/`, and shadows
a bundled one of the same name. Never edit anything under `node_modules`.

## A statement dbu6 cannot read

The Import statements screen recognizes a layout by trying each parser against
the upload. When none matches, it hands you a prompt for your coding agent:

* Copy the prompt and paste it into your agent, or
* click **Open in Claude Code** (or **Codex**, or **Pi**) to start the agent on
  it in a new terminal window, in your books folder. On Linux the button gives
  you a command to run in a terminal instead.

Either way the agent reads `npx dbu6 docs parser-guide`, which is written so it
can produce an accurate parser in one shot, and every prompt asks it to show
you its steps first and do nothing until you say go. `npx dbu6 docs parsers`
has the conventions a parser follows.

## Transactions that are not a statement

Text copied from a PDF or a web page, HTML, CSV, or a list you typed goes
through the Import freeform transactions screen. It gives you a prompt for your
coding agent, which turns the transactions into a statement, asks you for the
opening and closing balances, and imports them into Drafts. The guide is
`npx dbu6 docs freeform-guide`.

## Balance checks

Before a statement is accepted, dbu6 looks up the last posted entry and balance
for that account and works out where the new statement should start. It then
checks the statement's balances against what the books compute from the
imported rows. A mismatch stops the import.

For bank statements with a running balance, every row is checked. For credit
card statements, which usually have no per-row balance, the opening and closing
balances of the statement are used instead.

Imported rows are held as drafts. In Review you reclassify what needs it, check
for duplicates against earlier imports, confirm the balance checks pass, and
post. Nothing reaches the books until you post; a draft that turns out to be
wrong can be discarded without touching them.
