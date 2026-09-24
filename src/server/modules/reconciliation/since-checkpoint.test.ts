import { describe, it, expect } from "vitest";
import type { PostedRow } from "../journals/index.js";
import type { Abacus } from "../statement/index.js";
import { moneyFromColumns, unsafeAsChrono as chrono } from "../values/index.js";
import {
  newTransactionsSinceReconciliation,
  ReconciliationMatchError,
} from "./since-checkpoint.js";

function txn(date: string, balance: number | null, deposit = 100): Abacus {
  return { date, narration: `n-${date}`, withdrawal: 0, deposit, balance };
}

describe("newTransactionsSinceReconciliation — anchoring cases", () => {
  it("returns all rows when there is no checkpoint", () => {
    const txns = [txn("2025-01-01", 100), txn("2025-01-02", 200)];
    expect(newTransactionsSinceReconciliation(chrono(txns), null)).toEqual(
      txns,
    );
  });

  it("anchors on a mid-day row whose post-balance matches", () => {
    const txns = [
      txn("2025-01-01", 100),
      txn("2025-01-02", 200),
      txn("2025-01-02", 300),
      txn("2025-01-03", 400),
    ];
    const survivors = newTransactionsSinceReconciliation(chrono(txns), {
      date: "2025-01-02",
      balance: 200,
    });
    expect(survivors.map((t) => t.balance)).toEqual([300, 400]);
  });

  it("anchors on the last of multiple same-day matches", () => {
    const txns = [
      txn("2025-01-01", 100),
      txn("2025-01-02", 200),
      txn("2025-01-02", 300),
      txn("2025-01-02", 200),
      txn("2025-01-02", 400),
      txn("2025-01-03", 500),
    ];
    const survivors = newTransactionsSinceReconciliation(chrono(txns), {
      date: "2025-01-02",
      balance: 200,
    });
    expect(survivors.map((t) => t.balance)).toEqual([400, 500]);
  });

  it("uses an opening-edge anchor when opening hint matches", () => {
    const txns = [
      txn("2025-01-02", 300),
      txn("2025-01-02", 400),
      txn("2025-01-03", 500),
    ];
    const survivors = newTransactionsSinceReconciliation(
      chrono(txns),
      { date: "2025-01-02", balance: 200 },
      200,
    );
    expect(survivors.map((t) => t.balance)).toEqual([300, 400, 500]);
  });

  it("keeps first-day continuation rows when statement opening matches checkpoint", () => {
    const txns: Abacus[] = [
      {
        date: "2026-04-01",
        narration: "IB BILLPAY DR-HDFCSI-050505XXXXXX0505",
        withdrawal: 1000000,
        deposit: 0,
        balance: 1050505.0,
      },
    ];
    const survivors = newTransactionsSinceReconciliation(
      chrono(txns),
      { date: "2026-04-01", balance: 2050505.0 },
      2050505.0,
    );
    expect(survivors).toEqual(txns);
  });

  it("returns empty when the checkpoint sits past the last row", () => {
    const txns = [txn("2025-01-01", 100), txn("2025-01-02", 200)];
    const survivors = newTransactionsSinceReconciliation(chrono(txns), {
      date: "2025-01-10",
      balance: 999,
    });
    expect(survivors).toEqual([]);
  });

  it("returns empty when a re-upload anchors on the last row", () => {
    const txns = [
      txn("2025-01-01", 100),
      txn("2025-01-02", 200),
      txn("2025-01-03", 300),
    ];
    const survivors = newTransactionsSinceReconciliation(chrono(txns), {
      date: "2025-01-03",
      balance: 300,
    });
    expect(survivors).toEqual([]);
  });

  it("prefers same-day row anchor over opening-edge anchor", () => {
    const txns = [
      txn("2025-01-02", 300),
      txn("2025-01-02", 200),
      txn("2025-01-02", 400),
    ];
    const survivors = newTransactionsSinceReconciliation(
      chrono(txns),
      { date: "2025-01-02", balance: 200 },
      200,
    );
    expect(survivors.map((t) => t.balance)).toEqual([400]);
  });

  it("throws when same-day rows exist but no anchor matches", () => {
    const txns = [txn("2025-01-02", 300), txn("2025-01-02", 400)];
    expect(() =>
      newTransactionsSinceReconciliation(chrono(txns), {
        date: "2025-01-02",
        balance: 200,
      }),
    ).toThrow(ReconciliationMatchError);
  });

  it("throws about null balances only when no other anchor could fit", () => {
    const txns = [txn("2025-01-02", null)];
    expect(() =>
      newTransactionsSinceReconciliation(chrono(txns), {
        date: "2025-01-02",
        balance: 200,
      }),
    ).toThrow(/has no running balance/);
  });

  it("lets opening-edge anchor rescue null same-day balances", () => {
    const txns = [txn("2025-01-02", null), txn("2025-01-03", null)];
    const survivors = newTransactionsSinceReconciliation(
      chrono(txns),
      { date: "2025-01-02", balance: 200 },
      200,
    );
    expect(survivors).toHaveLength(2);
  });
});

// A keyed row: its key is its narration, as good as a digest here.
function keyed(
  date: string,
  key: string,
  amount: number,
  balance: number,
): Abacus {
  return {
    date,
    narration: key,
    ...moneyFromColumns({
      withdrawal: amount < 0 ? -amount : 0,
      deposit: amount > 0 ? amount : 0,
    }),
    balance,
    source_transaction_key: key,
  };
}

// A row the books hold on the checkpoint day. By default this account's own
// import posted it, keyed as `keyed` keys it, and the checkpoint counted it.
function posted(
  narration: string,
  amount: number,
  row: Partial<PostedRow> = {},
): PostedRow {
  return {
    origin: "statement",
    key: narration,
    amount,
    narration,
    counted: true,
    ...row,
  };
}

// A card payment or transfer the other account's import posted.
const fromOtherStatement = (
  narration: string,
  amount: number,
  counted = true,
) =>
  posted(narration, amount, { origin: "other-statement", key: null, counted });

// A journal with no key: entered by hand, or imported before rows were keyed.
const unkeyed = (narration: string, amount: number) =>
  posted(narration, amount, { origin: "unkeyed", key: null });

const newOnes = (
  txns: Abacus[],
  rows: PostedRow[] | null,
  opening: number | null = null,
  checkpoint = { date: "2026-05-10", balance: 5000 },
) =>
  newTransactionsSinceReconciliation(
    chrono(txns),
    checkpoint,
    opening,
    rows,
  ).map((t) => t.narration);

describe("newTransactionsSinceReconciliation — the checkpoint day by key", () => {
  it("keeps a round trip back to the checkpoint after a mid-day cut", () => {
    const txns = [
      keyed("2026-05-09", "sample-prior", -100, 4000),
      keyed("2026-05-10", "sample-morning", 1000, 5000),
      keyed("2026-05-10", "NOPII-SALARY", 1000, 6000),
      keyed("2026-05-10", "NOPII-RENT", -1000, 5000),
      keyed("2026-05-11", "sample-next", -100, 4900),
    ];
    expect(newOnes(txns, [posted("sample-morning", 1000)])).toEqual([
      "NOPII-SALARY",
      "NOPII-RENT",
      "sample-next",
    ]);
    // By balance alone, the rent's return to 5000 hides both.
    expect(newOnes(txns, null)).toEqual(["sample-next"]);
  });

  it("keeps a failed debit and its reversal after the checkpoint", () => {
    // A paste that starts after the rows posted that day, at their balance.
    const txns = [
      keyed("2026-05-10", "UPI-sample-050505-debit", -1000, 4000),
      keyed("2026-05-10", "UPI-sample-050505-reversal", 1000, 5000),
      keyed("2026-05-10", "sample-tea", -100, 4900),
    ];
    expect(newOnes(txns, [posted("sample-morning", 1000)], 5000)).toEqual([
      "UPI-sample-050505-debit",
      "UPI-sample-050505-reversal",
      "sample-tea",
    ]);
  });

  it("finds nothing new on a day the books already hold whole", () => {
    const txns = [
      keyed("2026-05-09", "sample-prior", -100, 5000),
      keyed("2026-05-10", "a", -500, 4500),
      keyed("2026-05-10", "b", 500, 5000),
      keyed("2026-05-10", "c", -200, 4800),
      keyed("2026-05-10", "d", 200, 5000),
      keyed("2026-05-11", "e", -100, 4900),
    ];
    const rows = [
      posted("a", -500),
      posted("b", 500),
      posted("c", -200),
      posted("d", 200),
    ];
    expect(newOnes(txns, rows)).toEqual(["e"]);
  });

  it("does not depend on the order the statement prints the day in", () => {
    // Posted: a (-100) and b (-200), from 4800 at the day's start to 4500.
    // The new statement prints b and a on either side of a new row.
    const txns = [
      keyed("2026-05-09", "sample-prior", -100, 4800),
      keyed("2026-05-10", "b", -200, 4600),
      keyed("2026-05-10", "new", 300, 4900),
      keyed("2026-05-10", "a", -100, 4800),
    ];
    const checkpoint = { date: "2026-05-10", balance: 4500 };
    const rows = [posted("a", -100), posted("b", -200)];
    expect(newOnes(txns, rows, null, checkpoint)).toEqual(["new"]);
    // By balance alone, no row lands on 4500.
    expect(() =>
      newTransactionsSinceReconciliation(chrono(txns), checkpoint),
    ).toThrow(ReconciliationMatchError);
  });

  it("falls back to the balance when the rows found don't reach the checkpoint", () => {
    // A paste that starts mid-day at 4700, after the posted row: a row the
    // books never had sits between them, so this is a gap.
    const txns = [keyed("2026-05-10", "sample-late", -100, 4600)];
    expect(() => newOnes(txns, [posted("sample-morning", 1000)])).toThrow(
      ReconciliationMatchError,
    );
  });
});

describe("newTransactionsSinceReconciliation — the checkpoint day by amount", () => {
  it("pairs a card payment posted from the card's statement", () => {
    // The card's import posted the payment, keyed by the card's statement,
    // so no row here carries its key.
    const txns = [
      keyed("2026-05-09", "sample-prior", -100, 5600),
      keyed("2026-05-10", "CC-PAYMENT-050505", -500, 5100),
      keyed("2026-05-10", "sample-groceries", -100, 5000),
      keyed("2026-05-10", "NOPII-SALARY", 1000, 6000),
      keyed("2026-05-10", "NOPII-RENT", -1000, 5000),
    ];
    const rows = [
      fromOtherStatement("NOPII PAYMENT RECEIVED", -500),
      posted("sample-groceries", -100),
    ];
    expect(newOnes(txns, rows)).toEqual(["NOPII-SALARY", "NOPII-RENT"]);
    expect(newOnes(txns, null)).toEqual([]);
  });

  it("pairs a card payment posted after the checkpoint, outside its balance", () => {
    // The payment reached this account after the last import's cut, and the
    // card's import posted it later.
    const txns = [
      keyed("2026-05-09", "sample-prior", -100, 5100),
      keyed("2026-05-10", "sample-groceries", -100, 5000),
      keyed("2026-05-10", "CC-PAYMENT-050505", -500, 4500),
      keyed("2026-05-10", "sample-tea", -50, 4450),
    ];
    const rows = [
      posted("sample-groceries", -100),
      fromOtherStatement("NOPII PAYMENT RECEIVED", -500, false),
    ];
    expect(newOnes(txns, rows)).toEqual(["sample-tea"]);
    // By balance alone, the payment comes in a second time.
    expect(newOnes(txns, null)).toEqual(["CC-PAYMENT-050505", "sample-tea"]);
  });

  it("pairs a row the bank reworded", () => {
    const txns = [
      keyed("2026-05-09", "sample-prior", -100, 4000),
      keyed("2026-05-10", "sample-morning-reworded", 1000, 5000),
      keyed("2026-05-10", "NOPII-SALARY", 2000, 7000),
      keyed("2026-05-10", "NOPII-RENT", -2000, 5000),
    ];
    expect(newOnes(txns, [posted("sample-morning", 1000)])).toEqual([
      "NOPII-SALARY",
      "NOPII-RENT",
    ]);
  });

  it("pairs a day posted before rows were keyed by amount and wording", () => {
    const txns = [
      keyed("2026-05-09", "sample-prior", -100, 4000),
      keyed("2026-05-10", "sample-morning", 1000, 5000),
      keyed("2026-05-10", "NOPII-SALARY", 1000, 6000),
      keyed("2026-05-10", "NOPII-RENT", -1000, 5000),
    ];
    expect(newOnes(txns, [unkeyed("SAMPLE-MORNING", 1000)])).toEqual([
      "NOPII-SALARY",
      "NOPII-RENT",
    ]);
  });

  it("falls back to the balance when two rows could be the one in the books", () => {
    // Either -1000 could be the rent entered by hand, and each choice reaches
    // the checkpoint, so the pairing doesn't guess.
    const txns = [
      keyed("2026-05-09", "sample-prior", -100, 6000),
      keyed("2026-05-10", "NOPII-RENT-BY-NEFT", -1000, 5000),
      keyed("2026-05-10", "NOPII-SALARY", 1000, 6000),
      keyed("2026-05-10", "UPI-sample-050505", -1000, 5000),
    ];
    const rows = [unkeyed("NOPII rent", -1000)];
    expect(newOnes(txns, rows)).toEqual(newOnes(txns, null));
  });

  it("falls back to the balance when a row in the books isn't in the whole day", () => {
    const txns = [
      keyed("2026-05-09", "sample-prior", -100, 4000),
      keyed("2026-05-10", "sample-morning", 1000, 5000),
      keyed("2026-05-10", "sample-after", -100, 4900),
    ];
    const rows = [posted("sample-morning", 1000), unkeyed("sample cash", -200)];
    expect(newOnes(txns, rows)).toEqual(["sample-after"]);
  });

  it("falls back to the balance for a paste on a day with an unkeyed journal", () => {
    // The paste may start after the journal's row, so amounts can't pair it.
    const txns = [
      keyed("2026-05-10", "UPI-sample-050505-debit", -1000, 4000),
      keyed("2026-05-10", "UPI-sample-050505-reversal", 1000, 5000),
      keyed("2026-05-10", "sample-tea", -100, 4900),
    ];
    const rows = [unkeyed("sample-morning", 1000)];
    expect(newOnes(txns, rows, 5000)).toEqual(newOnes(txns, null, 5000));
  });
});
