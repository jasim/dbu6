import { describe, it, expect } from "vitest";
import {
  applyCreditCardSignFlip,
  normalizeChronological,
  parseAbacusJson,
  type AbacusStatement,
} from "./index.js";
import { AbacusJsonParseError } from "../import-errors.js";
import { toDraftRows } from "../draft-persistence.js";
import { chronoMap } from "../domain/Chrono.js";
import { parseAccount, UNCATEGORIZED } from "../domain/Account.js";

function stubDb() {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    all: () => [],
  };
  return chain;
}

describe("parseAbacusJson", () => {
  it("rejects malformed JSON", () => {
    expect(() => parseAbacusJson("{not json", "test")).toThrow(
      AbacusJsonParseError,
    );
  });

  it("rejects schema violations", () => {
    expect(() =>
      parseAbacusJson('{"kind": "abacus", "rows": [{}]}', "test"),
    ).toThrow(AbacusJsonParseError);
  });

  it("accepts a document with rows and nothing else", () => {
    const document = {
      kind: "abacus",
      rows: [
        {
          date: "2026-07-15",
          narration: "Canonical row",
          withdrawal: 100,
          deposit: 0,
          balance: null,
        },
      ],
    };
    const result = parseAbacusJson(JSON.stringify(document), "test");

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].narration).toBe("Canonical row");
    expect(result.opening).toBeNull();
    expect(result.closing).toBeNull();
  });

  it.each([
    ["an empty transaction list", null],
    ["non-ISO date", { date: "15/07/2026" }],
    ["negative withdrawal", { withdrawal: -100, deposit: 100 }],
    ["both amounts zero", { withdrawal: 0, deposit: 0 }],
    ["both amounts positive", { withdrawal: 100, deposit: 100 }],
  ])("rejects %s at the Abacus JSON boundary", (_label, override) => {
    const row = {
      date: "2026-07-15",
      narration: "Invalid row",
      withdrawal: 100,
      deposit: 0,
      balance: null,
      ...override,
    };

    const rows = override === null ? [] : [row];

    expect(() =>
      parseAbacusJson(JSON.stringify({ kind: "abacus", rows }), "test"),
    ).toThrow(AbacusJsonParseError);
  });

  it("carries the statement's account through when present", () => {
    const row = {
      date: "2026-07-15",
      narration: "Row",
      withdrawal: 100,
      deposit: 0,
      balance: null,
    };
    const bank = parseAbacusJson(
      JSON.stringify({
        kind: "abacus",
        account: { kind: "bank", identifier: "050505000012" },
        rows: [row],
      }),
      "test",
    );
    expect(bank.account).toEqual({ kind: "bank", identifier: "050505000012" });

    const card = parseAbacusJson(
      JSON.stringify({
        kind: "abacus",
        account: { kind: "card", identifier: "050505XXXXXX0505" },
        rows: [row],
      }),
      "test",
    );
    expect(card.account).toEqual({
      kind: "card",
      identifier: "050505XXXXXX0505",
    });

    const absent = parseAbacusJson(
      JSON.stringify({ kind: "abacus", rows: [row] }),
      "test",
    );
    expect(absent.account).toBeNull();
    expect(absent.institution).toBeNull();
  });

  it("carries the printed institution name through verbatim", () => {
    const row = {
      date: "2026-07-15",
      narration: "Row",
      withdrawal: 100,
      deposit: 0,
      balance: null,
    };
    const named = parseAbacusJson(
      JSON.stringify({
        kind: "abacus",
        institution: "HDFC BANK Ltd.",
        rows: [row],
      }),
      "test",
    );
    expect(named.institution).toBe("HDFC BANK Ltd.");
    expect(
      parseAbacusJson(
        JSON.stringify({ kind: "abacus", institution: null, rows: [row] }),
        "test",
      ).institution,
    ).toBeNull();
    expect(() =>
      parseAbacusJson(
        JSON.stringify({ kind: "abacus", institution: "  ", rows: [row] }),
        "test",
      ),
    ).toThrow(AbacusJsonParseError);
  });

  it.each([
    [
      "a bank identifier with a mask",
      { kind: "bank", identifier: "0505XXXX0505" },
    ],
    [
      "a card identifier with spaces",
      { kind: "card", identifier: "0505 05XX XXXX 0505" },
    ],
    ["a lowercase mask", { kind: "card", identifier: "050505xxxxxx0505" }],
    ["an unknown kind", { kind: "loan", identifier: "050505000012" }],
    ["an empty identifier", { kind: "bank", identifier: "" }],
  ])("rejects %s as a statement account", (_label, account) => {
    expect(() =>
      parseAbacusJson(
        JSON.stringify({
          kind: "abacus",
          account,
          rows: [
            {
              date: "2026-07-15",
              narration: "Row",
              withdrawal: 100,
              deposit: 0,
              balance: null,
            },
          ],
        }),
        "test",
      ),
    ).toThrow(AbacusJsonParseError);
  });

  it("normalizes descending JSON to chronological order", () => {
    const json = JSON.stringify({
      kind: "abacus",
      opening: null,
      closing: 4640.75,
      rows: [
        {
          date: "2026-04-25",
          narration: "next-day",
          withdrawal: 100,
          deposit: 0,
          balance: 4640.75,
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
    const result = parseAbacusJson(json, "test");
    expect(result.transactions.map((t) => [t.date, t.narration])).toEqual([
      ["2026-04-24", "tx-early"],
      ["2026-04-24", "tx-mid"],
      ["2026-04-24", "tx-late"],
      ["2026-04-25", "next-day"],
    ]);
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
      account: UNCATEGORIZED,
    }));
    const { rows, expectedClosingByDate } = toDraftRows(
      stubDb(),
      parseAccount("assets:bank:stanc"),
      categorized,
    );
    expect(
      rows.every((row) => row.balance_assertion_base_account === null),
    ).toBe(true);
    expect([...expectedClosingByDate.values()]).toEqual([4740.75, 3740.25]);
  });
});

describe("applyCreditCardSignFlip", () => {
  const base: AbacusStatement = {
    transactions: normalizeChronological(
      [
        {
          date: "2025-01-01",
          narration: "t1",
          withdrawal: 500,
          deposit: 0,
          balance: 9500,
        },
        {
          date: "2025-01-02",
          narration: "t2",
          withdrawal: 0,
          deposit: 200,
          balance: null,
        },
      ],
      "ascending",
    ),
    opening: 10000,
    closing: 9500,
    account: null,
    institution: null,
  };

  it("is an identity when isCreditCard is false", () => {
    expect(applyCreditCardSignFlip(base, false)).toEqual(base);
  });

  it("flips balances (opening/closing/per-row) but not withdrawal/deposit", () => {
    const flipped = applyCreditCardSignFlip(base, true);
    expect(flipped.opening).toBe(-10000);
    expect(flipped.closing).toBe(-9500);
    expect(flipped.transactions[0].balance).toBe(-9500);
    expect(flipped.transactions[0].withdrawal).toBe(500);
    expect(flipped.transactions[0].deposit).toBe(0);
    expect(flipped.transactions[1].balance).toBeNull();
  });

  it("leaves null balances null on flip", () => {
    const allNull: AbacusStatement = {
      ...base,
      transactions: normalizeChronological(
        [{ ...base.transactions[0], balance: null }],
        "ascending",
      ),
      opening: null,
      closing: null,
      account: null,
      institution: null,
    };
    const flipped = applyCreditCardSignFlip(allNull, true);
    expect(flipped.opening).toBeNull();
    expect(flipped.closing).toBeNull();
    expect(flipped.transactions[0].balance).toBeNull();
  });
});
