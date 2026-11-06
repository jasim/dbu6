# Failing balance checks in Review

## When

An account's drafts have failing balance checks: on some day the running
total misses the balance the statement printed. Review's Balance checks tab
lists them, and `npx sapporta api get /api/review/accounts/<id>` returns them
as `failing` (date, draft, running balance, statement balance, `diff`).
These are drafts' checks; a posted check the books miss is
`npx dbu6 docs playbook posted-balance-check`.

## Read

- "When a balance check fails" in `npx dbu6 docs books`: how the running
  total is added up, the usual causes, and the account's activity around a
  day (`/api/accounts/<id>/activity`).
- The account's last statement balance in the books (`checkpoint`), and its
  drafts' dates.

## Change

Start from the first failing day; later ones usually follow from it. Look
for an amount equal to `diff`, or to the change in `diff` between two
failing days. Propose each change as date, description, amount, and what it
becomes.

A difference that a transfer or card payment between two of the user's
accounts could explain goes to the `double-counted-transfers` playbook,
whether its other side is a draft or already in the books. In a run, that
is its own task, after every statement is imported and categorized.
Outside a run, propose its changes like any other, and report them under
that playbook's headings.

## Never

- Change a statement balance (`balance_assertion_base_account`,
  `account_balance_assertion`).
- Delete a draft just to make a check pass.

## Report

- **What's wrong:** why the running balance misses the statement's, in one
  sentence.
- **The fix:** each change as date, description, amount, and what it
  becomes.
- **After the fix:** which checks pass, and anything still unexplained.
