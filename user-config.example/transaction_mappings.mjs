// Deterministic transaction mappings, applied before the LLM is consulted.
// Pure data — the matching engine is dbu6's.
//
// Narrations are normalized before matching: Unicode NFKC, runs of whitespace
// collapsed to one space, trimmed, upper-cased. Write patterns in whatever
// case is convenient.

export const mappings = {
  // Whole-narration matches. Checked first, and they always win. A key that
  // is a UPI VPA (`payee@psp`) also matches when that VPA appears inside a
  // longer narration, e.g. `UPIOUT/<ref>/payee@psp/UPI/0000`.
  exact: {
    "ACME SUPERMARKET": "Groceries",
    "The Corner Cafe": "Food",
    "CITY TRANSIT AUTHORITY": "Travel",
    "billing@example-isp": "Internet",
  },

  // Substring matches, checked in this order after exact misses. Keep narrower
  // patterns ahead of broader category patterns.
  //
  //   account   - the account to assign, by its name in the Accounts table
  //   values    - substrings to look for in the narration
  //   direction - optional, "withdrawal" or "deposit"; omit to match both
  includes: [
    {
      account: "Electricity",
      values: ["CITY POWER", "ELECTRIC UTILITY"],
    },
    {
      account: "Groceries",
      values: ["SUPERMARKET", "GROCERS"],
    },
    {
      account: "Cash",
      direction: "withdrawal",
      values: ["TO ATM", "ATM WITHDRAWAL"],
    },
    {
      account: "Interest",
      direction: "deposit",
      values: ["INTEREST PAID"],
    },
  ],
};
