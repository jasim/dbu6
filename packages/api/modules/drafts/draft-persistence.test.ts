import { describe, it, expect } from "vitest";
import { type Abacus, parseAbacusJson } from "../statement/index.js";
import { chronoMap, unsafeAsChrono as chrono } from "../values/index.js";
import {
  toDraftRows,
  type CategorizedStatementRow,
} from "./draft-persistence.js";

const BASE_ACCOUNT_ID = 7;

function ct(date: string, balance: number): CategorizedStatementRow {
  const transaction: Abacus = {
    date,
    narration: `tx-${date}-${balance}`,
    withdrawal: 0,
    deposit: 100,
    balance,
  };
  return { transaction, accountId: null };
}

describe("toDraftRows — per-date balance assertion", () => {
  it("keeps the assertion only on the last row of each date", () => {
    const { rows, expectedClosingByDate } = toDraftRows(
      chrono([
        ct("2025-01-01", 100),
        ct("2025-01-01", 200),
        ct("2025-01-02", 300),
        ct("2025-01-02", 400),
        ct("2025-01-02", 500),
      ]),
      BASE_ACCOUNT_ID,
    );
    expect(rows.map((r) => r.balance_assertion_base_account)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect([...expectedClosingByDate]).toEqual([
      ["2025-01-01", 200],
      ["2025-01-02", 500],
    ]);
  });

  it("keeps the assertion on a single-row date", () => {
    const { rows, expectedClosingByDate } = toDraftRows(
      chrono([ct("2025-01-01", 100)]),
      BASE_ACCOUNT_ID,
    );
    expect(rows[0].balance_assertion_base_account).toBeNull();
    expect([...expectedClosingByDate]).toEqual([["2025-01-01", 100]]);
  });

  it("still drops all assertions when no row has a balance", () => {
    const { rows } = toDraftRows(
      chrono([
        {
          transaction: {
            date: "2025-01-01",
            narration: "n",
            withdrawal: 0,
            deposit: 100,
            balance: null,
          },
          accountId: null,
        },
      ]),
      BASE_ACCOUNT_ID,
    );
    expect(rows[0].balance_assertion_base_account).toBeNull();
  });
});

describe("descending Abacus JSON balance assertions", () => {
  it("stamps the day's chronologically-last balance", () => {
    const json = JSON.stringify({
      kind: "abacus",
      closing: 3740.25,
      rows: [
        {
          date: "2026-04-25",
          narration: "next-day",
          withdrawal: 1000.5,
          deposit: 0,
          balance: 3740.25,
        },
        {
          date: "2026-04-24",
          narration: "tx-late",
          withdrawal: 60,
          deposit: 0,
          balance: 4740.75,
        },
        {
          date: "2026-04-24",
          narration: "tx-mid",
          withdrawal: 200,
          deposit: 0,
          balance: 4800.75,
        },
        {
          date: "2026-04-24",
          narration: "tx-early",
          withdrawal: 500,
          deposit: 0,
          balance: 5000.75,
        },
      ],
    });
    const { transactions } = parseAbacusJson(json, "test");
    const categorized = chronoMap(transactions, (t) => ({
      transaction: t,
      accountId: null,
    }));
    const { rows, expectedClosingByDate } = toDraftRows(
      categorized,
      BASE_ACCOUNT_ID,
    );
    expect(
      rows.every((row) => row.balance_assertion_base_account === null),
    ).toBe(true);
    expect([...expectedClosingByDate.values()]).toEqual([4740.75, 3740.25]);
  });
});
