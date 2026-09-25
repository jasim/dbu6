import { describe, expect, it } from "vitest";
import type { OpeningBalanceAccount } from "../../../shared/index";
import {
  amountOf,
  openingRows,
  readRow,
  withSampleDate,
  type OpeningRow,
} from "./opening-rows";

function account(
  overrides: Partial<OpeningBalanceAccount> = {},
): OpeningBalanceAccount {
  return {
    account_id: 2,
    name: "Sample Savings",
    path: "Assets:Sample Savings",
    account_type: "Asset",
    first_activity_date: "2026-02-03",
    default_date: "2026-02-02",
    suggested_amount: null,
    opening: null,
    ...overrides,
  };
}

function row(overrides: Partial<OpeningRow> = {}): OpeningRow {
  return {
    accountId: 2,
    name: "Sample Savings",
    path: "Assets:Sample Savings",
    firstActivityDate: "2026-02-03",
    recorded: null,
    date: "2026-02-02",
    debit: null,
    credit: null,
    suggested: null,
    ...overrides,
  };
}

describe("openingRows", () => {
  it("puts a suggested balance on the side it belongs to", () => {
    const rows = openingRows({
      equity_account: null,
      accounts: [
        account({ suggested_amount: 1000 }),
        account({
          account_id: 4,
          name: "Sample Card",
          path: "Liabilities:Sample Card",
          account_type: "Liability",
          suggested_amount: -2500,
          first_activity_date: null,
          default_date: null,
        }),
      ],
    });

    expect(rows[0]).toMatchObject({
      date: "2026-02-02",
      debit: 1000,
      credit: null,
      suggested: "debit",
      recorded: null,
    });
    expect(rows[1]).toMatchObject({
      date: null,
      debit: null,
      credit: 2500,
      suggested: "credit",
    });
  });

  it("shows a recorded entry as it was posted, with nothing suggested", () => {
    const [asset, card] = openingRows({
      equity_account: { id: 9, name: "Opening Balances" },
      accounts: [
        account({
          opening: {
            journal_id: 31,
            date: "2026-01-31",
            amount: 1000,
            description: "From the NOPII closing statement",
          },
          suggested_amount: 4000,
        }),
        account({
          account_id: 4,
          account_type: "Liability",
          opening: {
            journal_id: 31,
            date: "2026-01-31",
            amount: -2500,
            description: "Opening balance",
          },
        }),
      ],
    });

    expect(asset).toMatchObject({
      recorded: {
        journalId: 31,
        description: "From the NOPII closing statement",
      },
      date: "2026-01-31",
      debit: 1000,
      credit: null,
      suggested: null,
    });
    expect(card).toMatchObject({ debit: null, credit: 2500 });
  });
});

describe("readRow", () => {
  it("reads a debit as money held and a credit as money owed", () => {
    expect(
      readRow({ date: "2026-02-02", debit: 1000, credit: null }, row()),
    ).toEqual({ ok: true, date: "2026-02-02", amount: 1000 });
    expect(
      readRow({ date: "2026-01-31", debit: null, credit: 2500 }, row()),
    ).toEqual({ ok: true, date: "2026-01-31", amount: -2500 });
  });

  it("wants a date before the account's first transaction", () => {
    expect(readRow({ date: "", debit: 1000, credit: null }, row())).toEqual({
      ok: false,
      problem: "Pick a date.",
    });
    expect(
      readRow({ date: "2026-02-03", debit: 1000, credit: null }, row()),
    ).toEqual({
      ok: false,
      problem: "The date must be before the account's first transaction.",
    });
    expect(
      readRow(
        { date: "2030-01-01", debit: 1000, credit: null },
        row({ firstActivityDate: null, date: null }),
      ),
    ).toMatchObject({ ok: true });
  });

  it("wants one side, filled with a positive number", () => {
    const date = "2026-02-02";
    expect(readRow({ date, debit: null, credit: null }, row())).toEqual({
      ok: false,
      problem: "Enter a debit or a credit.",
    });
    expect(readRow({ date, debit: 1000, credit: 2500 }, row())).toEqual({
      ok: false,
      problem: "Enter either a debit or a credit, not both.",
    });
    expect(readRow({ date, debit: "ten", credit: null }, row())).toEqual({
      ok: false,
      problem: "Enter the amount as a number.",
    });
    expect(readRow({ date, debit: null, credit: -2500 }, row())).toEqual({
      ok: false,
      problem: "Amounts are positive: money owed goes in credit.",
    });
    // An account that opened at nothing still says so on a side.
    expect(readRow({ date, debit: 0, credit: null }, row())).toEqual({
      ok: true,
      date,
      amount: 0,
    });
  });

  it("refuses a row the books already hold", () => {
    expect(
      readRow(
        { date: "2026-01-31", debit: 1000, credit: null },
        row({ recorded: { journalId: 31, description: "Opening balance" } }),
      ),
    ).toEqual({
      ok: false,
      problem: "This account already has an opening entry.",
    });
  });
});

describe("amountOf", () => {
  it("reads a cell's number, its emptiness, or that it isn't one", () => {
    expect(amountOf(1000)).toBe(1000);
    expect(amountOf("2,500.50")).toBe(2500.5);
    expect(amountOf(" ₹ 1,000 ")).toBe(1000);
    expect(amountOf(null)).toBeNull();
    expect(amountOf("")).toBeNull();
    for (const text of ["abc", "10-5", "1.2.3", "-"]) {
      expect(amountOf(text), text).toBe("invalid");
    }
  });
});

describe("withSampleDate", () => {
  it("dates a new account the day before its sample statement's first row", () => {
    const fresh = row({ date: null, firstActivityDate: null });
    expect(withSampleDate([fresh], "Sample Savings", "2026-03-01")).toEqual([
      { ...fresh, date: "2026-02-28" },
    ]);
  });

  it("leaves an account with a date of its own, another account, or a bad date", () => {
    const own = row();
    const other = row({ name: "Sample Card", date: null });
    expect(
      withSampleDate([own, other], "Sample Savings", "2026-03-01"),
    ).toEqual([own, other]);
    expect(
      withSampleDate([row({ date: null })], "Sample Savings", "not a date"),
    ).toEqual([row({ date: null })]);
  });
});
