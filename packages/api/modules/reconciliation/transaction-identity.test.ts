import { describe, expect, it } from "vitest";
import type { Abacus } from "../../bank-importer/abacus/index.js";
import { parseAccount } from "../../bank-importer/domain/Account.js";
import { unsafeAsChrono } from "../../bank-importer/domain/Chrono.js";
import { assignSourceTransactionKeys } from "./transaction-identity.js";

describe("assignSourceTransactionKeys", () => {
  const base = parseAccount("cc:stanc");

  it("prefers a stable issuer reference", () => {
    const [first] = assignSourceTransactionKeys(
      unsafeAsChrono([
        {
          date: "2026-05-07",
          narration: "Merchant",
          withdrawal: 10,
          deposit: 0,
          balance: null,
          source_reference: " 05050500000000000000001 ",
        },
      ]),
      base,
    );
    const [second] = assignSourceTransactionKeys(
      unsafeAsChrono([
        {
          date: "2026-05-07",
          narration: "Merchant renamed",
          withdrawal: 10,
          deposit: 0,
          balance: null,
          source_reference: "05050500000000000000001",
        },
      ]),
      base,
    );
    expect(first.source_transaction_key).toBe(second.source_transaction_key);
  });

  it("keeps distinct HDFC fee rows that reuse issuer references", () => {
    const hdfc = parseAccount("cc:hdfc");
    const rows = unsafeAsChrono<Abacus>([
      {
        date: "2026-07-11",
        narration: "1.75% on all DCC Transaction",
        withdrawal: 100.25,
        deposit: 0,
        balance: null,
        source_reference: "ST050505000000000000001",
      },
      {
        date: "2026-07-11",
        narration: "IGST-VPS0505050000001- RATE 18.0 -29",
        withdrawal: 18.05,
        deposit: 0,
        balance: null,
        source_reference: "ST050505000000000000001",
      },
      {
        date: "2026-07-17",
        narration: "1.75% on all DCC Transaction",
        withdrawal: 50.5,
        deposit: 0,
        balance: null,
        source_reference: "ST050505000000000000002",
      },
      {
        date: "2026-07-17",
        narration: "IGST-VPS0505050000002- RATE 18.0 -29",
        withdrawal: 9.09,
        deposit: 0,
        balance: null,
        source_reference: "ST050505000000000000002",
      },
      {
        date: "2026-07-17",
        narration: "IGST-VPS0505050000003- RATE 18.0 -29",
        withdrawal: 20.2,
        deposit: 0,
        balance: null,
        source_reference: "VT050505000000000000003",
      },
      {
        date: "2026-07-18",
        narration: "CONSOLIDATED FCY MARKUP FEE",
        withdrawal: 200.75,
        deposit: 0,
        balance: null,
        source_reference: "VT050505000000000000003",
      },
    ]);

    const firstKeys = assignSourceTransactionKeys(rows, hdfc).map(
      (row) => row.source_transaction_key,
    );
    const secondKeys = assignSourceTransactionKeys(rows, hdfc).map(
      (row) => row.source_transaction_key,
    );

    expect(new Set(firstKeys).size).toBe(rows.length);
    expect(secondKeys).toEqual(firstKeys);
  });

  it("uses occurrence indexes for identical referenced rows", () => {
    const rows = assignSourceTransactionKeys(
      unsafeAsChrono([
        {
          date: "2026-05-07",
          narration: "Fee",
          withdrawal: 100,
          deposit: 0,
          balance: null,
          source_reference: "shared-reference",
        },
        {
          date: "2026-05-07",
          narration: "Fee duplicate",
          withdrawal: 100,
          deposit: 0,
          balance: null,
          source_reference: "shared-reference",
        },
      ]),
      base,
    );
    expect(rows[0].source_transaction_key).not.toBe(
      rows[1].source_transaction_key,
    );
  });

  it("uses occurrence indexes for otherwise-identical statement rows", () => {
    const rows = assignSourceTransactionKeys(
      unsafeAsChrono([
        {
          date: "2026-05-07",
          narration: "Fee",
          withdrawal: 100,
          deposit: 0,
          balance: null,
        },
        {
          date: "2026-05-07",
          narration: "Fee",
          withdrawal: 100,
          deposit: 0,
          balance: null,
        },
      ]),
      base,
    );
    expect(rows[0].source_transaction_key).not.toBe(
      rows[1].source_transaction_key,
    );
    expect(
      assignSourceTransactionKeys(unsafeAsChrono([rows[0], rows[1]]), base).map(
        (row) => row.source_transaction_key,
      ),
    ).toEqual(rows.map((row) => row.source_transaction_key));
  });
});
