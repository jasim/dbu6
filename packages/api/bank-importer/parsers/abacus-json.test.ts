import { describe, it, expect } from "vitest";
import { parseAbacusJson } from "./abacus-json.js";
import { AbacusJsonParseError } from "../import-errors.js";
import { toDraftRows } from "../draft-persistence.js";
import { chronoMap } from "../domain/Chrono.js";
import { parseAccount, UNCATEGORIZED } from "../domain/Account.js";
import { abacusRowsJsonSchema } from "../domain/Abacus.js";

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

  it("accepts the canonical transaction-extraction document shape", () => {
    const generated = abacusRowsJsonSchema.parse({
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
    });
    const result = parseAbacusJson(JSON.stringify(generated), "test");

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
