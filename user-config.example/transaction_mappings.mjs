// Deterministic transaction mappings, applied before the LLM is consulted.
// Pure data — the matching engine lives in
// packages/api/bank-importer/categorization/mapping-rules.ts.
//
// Narrations are normalized before matching: Unicode NFKC, runs of whitespace
// collapsed to one space, trimmed, upper-cased. Write patterns in whatever
// case is convenient.

export const mappings = {
  // Whole-narration matches. Checked first, and they always win.
  exact: {
    "ACME SUPERMARKET": "expenses:grocery",
    "The Corner Cafe": "expenses:food",
    "CITY TRANSIT AUTHORITY": "expenses:travel",
    "billing@example-isp": "expenses:home:internet",
  },

  // Substring matches, checked in this order after exact misses. Keep narrower
  // patterns ahead of broader category patterns.
  //
  //   account   - the account to assign
  //   values    - substrings to look for in the narration
  //   direction - optional, "withdrawal" or "deposit"; omit to match both
  includes: [
    {
      account: "expenses:home:electricity",
      values: ["CITY POWER", "ELECTRIC UTILITY"],
    },
    {
      account: "expenses:grocery",
      values: ["SUPERMARKET", "GROCERS"],
    },
    {
      account: "expenses:atm",
      direction: "withdrawal",
      values: ["TO ATM", "ATM WITHDRAWAL"],
    },
    {
      account: "income:credit-interest",
      direction: "deposit",
      values: ["INTEREST PAID"],
    },
  ],
};
