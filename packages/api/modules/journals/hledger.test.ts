import { describe, expect, it } from "vitest";
import { formatJournalsAsHledger } from "./hledger.js";

describe("formatJournalsAsHledger", () => {
  it("formats posted journals with signed amounts, assertions, and comments", () => {
    const output = formatJournalsAsHledger([
      {
        id: 2,
        date: "2026-07-09",
        description: "Expenses",
        entries: [
          {
            account: "expenses:food",
            amount: 125.5,
            assertion: null,
            comment: "Lunch",
          },
          {
            account: "assets:bank",
            amount: -125.5,
            assertion: 999.25,
            comment: null,
          },
        ],
      },
      {
        id: 3,
        date: "2026-07-10",
        description: "Deposits",
        entries: [
          {
            account: "assets:bank",
            amount: 2000,
            assertion: null,
            comment: null,
          },
        ],
      },
    ]);

    expect(output).toBe(
      [
        "2026-07-09 Expenses",
        "    expenses:food                           125.50 ; Lunch",
        "    assets:bank                            -125.50 = 999.25",
        "",
        "2026-07-10 Deposits",
        "    assets:bank                            2000.00",
      ].join("\n"),
    );
  });
});
