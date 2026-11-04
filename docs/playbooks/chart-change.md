# Changing the chart of accounts

## When

The user wants accounts renamed, moved under another parent, merged into
one, or split in two, with the entries and drafts on them going where the
new chart says. On screen this is the Accounts page (`/accounts`), one
account at a time.

## Read

- The chart: `npx sapporta rows list accounts --output json`. The tree
  comes from `parent_id`; reports group by `account_type`. A name is a plain
  name, unique in the books ("Eating out", not "Food:Eating out"): never put
  the parent in it.
- For each account the change touches, what is on it, with SQL
  (`sqlite3 -readonly`): its posted entries (count, total, first and last
  date), drafts categorized to it, drafts from its own statements, its
  sub-accounts, and whether an import preset lists it
  (`npx sapporta api get /api/import-presets`).
- Where it is named by name: `user-config/transaction_mappings.mjs`, as a
  rule's `mapToAccount` or in its `statement`, and the
  `custom_mappings_*.prompt` files. A rename or merge changes both fields.
- "Rename or move an account" and "Add an account" in
  `npx dbu6 docs books`.

## Change

Plan first. Show the user the whole change and wait for a yes:

```
Change                                  Entries  Total     Drafts  Rules
Rename  Hotel food → Eating out               -  -              -      2
Merge   Snacks into Eating out               38  12,400         4      1
Split   Shopping → Clothes, Household       112  1,84,000       9      3
Delete  Snacks (empty after the merge)
```

The yes covers what the plan lists, and nothing else. Rules counts the
existing rules and prompt lines repointed or renamed, a rule's
`mapToAccount` and its `statement` both; new rules for a split
are asked after, one at a time. For a split, list
each group with a few descriptions, so the user agrees to where each goes.

What the API does for each:

- **Rename, move, retype:** `npx sapporta api put /api/accounts/<id> --body '{"name":"…","account_type":"…","parent_id":<id or null>}'`,
  name, type and parent together; a type change moves the whole branch.
  It refuses `ledger_name_taken`, `parent_not_suitable` (another type, or
  under itself), `opening_balances_fixed` and `bank_or_card_type_fixed`.
  Then make the same rename in `user-config/`. Import presets name the
  account by id; a preset account's own `name` is what the everyday screens
  call it, changed with `update_account` only if the user wants that too.
- **Merge A into B** (there is no merge endpoint): move A's sub-accounts
  under B, or elsewhere, with `PUT /api/accounts/<id>`; move each posted
  entry on A,
  `npx sapporta rows update journal_entries <entry id> --values '{"account_id":<B>}'`;
  move the drafts categorized to A,
  `npx sapporta api post /api/draft-transactions/set-account --body '{"ids":[…],"account_id":<B>}'`;
  point A's rules and prompt lines at B; then
  `npx sapporta api delete /api/accounts/<A>`, which refuses while anything
  is still on it (`has_entries`, `has_drafts`, `has_sub_accounts`). Two
  opening balances don't merge on their own: ask the user what B's is.
- **Split A:** create the new accounts,
  `npx sapporta rows create accounts --values '{"name":"…","account_type":"…","parent_id":<id>}'`;
  group A's entries and drafts by what they are, with SQL, as for "All my X
  payments are in the wrong account" in the books guide; move each group as
  for a merge; propose rules so future imports follow, each on its own
  yes. Keep A for what is left, or delete it once it is empty.

A bank or card (an import preset lists it) is never merged or split: its
entries carry its statements' balances. Rename or move it like any account;
change its type, or remove it, in Settings › Banks & cards.

Never lose an entry. Before writing, record each account's entry count and
total; after, the merged or split accounts' counts and totals must add up to
the same. The trial balance (`/api/reports/trial-balance`) totals don't
change.

## Never

- Delete a journal or an entry to move it: change its `account_id`.
- Change the line on a bank or card's own account: move the other side.
- Delete an account through `rows delete`: it skips the checks, and can
  leave a preset pointing at nothing.
- Put a parent in a name, or tell accounts apart by name in a report.

## Report

- **Changed:** each account renamed, moved, merged, split or deleted.
- **Moved:** entries and drafts per account, counts and totals before and
  after.
- **Rules:** each line in `user-config/` changed, by file.
- **Still open:** what the user still has to decide.
