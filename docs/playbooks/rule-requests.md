# Rule requests from Review

## When

The user made rule requests on Review's Improve categorization tab: drafts
they picked, each with its date, direction and amount, the account those
drafts go to, and a note for next time. They wait in the books
(`categorization_rule_requests`) until a coding agent encodes them.

## Read

- `npx sapporta api get /api/categorization-rule-requests --query '{"base_account_id":<id>}'`.
- "Always put this under X — adding a mapping" in `npx dbu6 docs books`.

## Change

For each rule request, propose how it is encoded: a rule in
`transaction_mappings.mjs`, a line of guidance in a `custom_mappings_*.prompt`
file, both, or why it shouldn't be. The user picked the drafts, so they may
share nothing the categorizer can see; say so when they don't. Encode what
the user agrees to.

What the categorizer sees decides what a rule can do:

- A draft's description, direction and amount, never its date.
- How it was paid (UPI, NEFT, card) is not something drafts share.
- Round an amount range out (60–480 becomes 50–500).
- The user's `user-config/` files may name payees and amounts.

A rule request comes from one statement's drafts. Its rule should read only
that statement's rows as well as it can. Say so when the text would catch
rows on other statements.

Delete a rule request once it's encoded, or when the user drops it, which
takes it off their list:
`npx sapporta api delete /api/categorization-rule-requests/<rule request id>`.
Leave one you couldn't encode.

## Report

- **Rules added:** for each rule request, the rule or line now in place and
  its file, or why none.
- **Still on the list:** the rule requests left.
