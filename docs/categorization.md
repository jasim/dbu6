# Categorization

Each imported transaction is assigned an account in two passes: your own rules
first, then a language model for whatever they miss.

## Your rules

`user-config/transaction_mappings.mjs` maps a narration to an account:

```js
export const mappings = {
    exact: {"ACME SUPERMARKET": "Groceries"},
    includes: [
        {account: "Fuel", direction: "withdrawal", values: ["FUELS"]},
    ],
};
```

* `exact` matches the whole narration and wins outright.
* `includes` matches a substring, is checked in order, and can be limited to
  `withdrawal` or `deposit`.

An account is named by its bare name, because each name is unique in your books
([Your books](your-books.md#accounts-and-journal-entries)).

## The LLM

Anything the rules miss goes to a coding agent on your own machine, logged in
with your own plan, together with your accounts (all but Equity, from the
Accounts table) and your written instructions on how to categorize. If the
answer is not confident, the entry is left blank for you.

Without an installed agent nothing is categorized this way, and only your
rules run. If the agent cannot be reached, the import still goes through and
says how many descriptions were left uncategorized, and why. **Settings** names
the agent dbu6 uses and lets you switch between Claude Code, Codex and Pi.

## Your instructions

The prompts the agent gets are in `user-config/`, one file per bank or card if
you want. `init` writes `custom_mappings_default.prompt` as a starting point;
edit it to describe your own accounts and habits.

Different banks and cards can list different prompt files in their import
presets. The presets are kept in the database, and your coding agent changes
them for you (`npx dbu6 docs books`).
