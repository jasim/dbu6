// Rules that decide where a statement's rows go, before the AI is asked.
// Each rule reads one statement's rows (or several, or every statement's)
// and says where money moving one way, with a description like this, went
// or came from. Pure data: the matching engine is dbu6's.
//
//   statement     the account whose statement prints the row, by its name in
//                 Accounts: one name, a list of names, or "*" for every
//                 statement. Never the account the money went to or came from.
//   money         "in", "out" or "either", relative to that account. On a
//                 card's statement, a bill payment is "in".
//   mapToAccount  where the money went or came from, by its name in Accounts
//
// "*" is for a payee's own name or UPI address, which means the same account
// on any statement. A rule to one of your own banks or cards (a transfer, a
// card bill) names the statement it reads, and goes on the side whose
// description names the other account:
//
//   {
//     statement: "Sample savings",
//     money: "out",
//     contains: ["BILLPAY SAMPLE CARD"],
//     mapToAccount: "Sample card",
//   },
//
// A rule never answers with the row's own statement account; when it would,
// the next rule or the AI gets the row.
//
// Descriptions are normalized before matching: Unicode NFKC, runs of
// whitespace collapsed to one space, trimmed, upper-cased. Write them in
// whatever case is convenient.

export const mappings = {
  // Whole-description matches. Checked first. A description that is a UPI
  // address (payee@psp) also matches inside a longer description, e.g.
  // `UPIOUT/<ref>/payee@psp/UPI/0000`.
  exact: [
    {
      statement: "*",
      money: "out",
      narrations: ["ACME SUPERMARKET"],
      mapToAccount: "Groceries",
    },
    {
      statement: "*",
      money: "out",
      narrations: ["The Corner Cafe"],
      mapToAccount: "Food",
    },
    {
      statement: "*",
      money: "out",
      narrations: ["CITY TRANSIT AUTHORITY"],
      mapToAccount: "Travel",
    },
    {
      statement: "*",
      money: "out",
      narrations: ["billing@example-isp"],
      mapToAccount: "Internet",
    },
  ],

  // Phrase matches, checked in this order after the exact rules; the first
  // to match wins. Put narrower phrases ahead of broader ones. A contains
  // rule may add `amount: { min, max }`: only amounts in this range, both
  // ends included; leave either end out to leave it open.
  contains: [
    {
      statement: "*",
      money: "out",
      contains: ["CITY CAR PARK"],
      amount: { max: 200 },
      mapToAccount: "Tolls & Parking",
    },
    {
      statement: "*",
      money: "out",
      contains: ["CITY POWER", "ELECTRIC UTILITY"],
      mapToAccount: "Electricity",
    },
    {
      statement: "*",
      money: "out",
      contains: ["SUPERMARKET", "GROCERS"],
      mapToAccount: "Groceries",
    },
    {
      statement: "*",
      money: "out",
      contains: ["TO ATM", "ATM WITHDRAWAL"],
      mapToAccount: "Cash",
    },
    {
      statement: "*",
      money: "in",
      contains: ["INTEREST PAID"],
      mapToAccount: "Interest",
    },
  ],
};
