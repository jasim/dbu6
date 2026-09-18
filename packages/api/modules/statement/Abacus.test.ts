import { describe, it, expect } from "vitest";
import { parseAbacusJson } from "./index.js";
import { AbacusJsonParseError } from "./import-errors.js";

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
