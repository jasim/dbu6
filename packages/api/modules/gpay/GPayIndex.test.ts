import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  enrichWithGPay,
  enrichWithGPayHtml,
  parseGPayHtml,
  type GPayIndex,
} from "./GPayIndex.js";
import type { Abacus } from "../statement/index.js";

function txn(partial: Partial<Abacus>): Abacus {
  return {
    date: "2026-04-24",
    narration: "bank narration",
    withdrawal: 0,
    deposit: 0,
    balance: null,
    ...partial,
  };
}

describe("parseGPayHtml", () => {
  it("indexes sent and paid entries by date and amount", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gpay-test-"));
    const file = path.join(dir, "takeout.html");
    writeFileSync(
      file,
      `
        <div>Sent ₹1,234.50 to Coffee &amp; Snacks using Bank Account</div>
        <div>Apr 24, 2026, 10:15 AM</div>
        <div>Paid Rs. 99 to Metro Card</div>
        <div>Apr 25, 2026, 8:30 PM</div>
      `,
    );

    try {
      const idx = parseGPayHtml(file);
      expect(idx.get("2026-04-24|1234.50")).toEqual(["Coffee & Snacks"]);
      expect(idx.get("2026-04-25|99.00")).toEqual(["Metro Card"]);

      const result = enrichWithGPayHtml(
        [txn({ withdrawal: 1234.5, narration: "UPI debit" })],
        file,
      );
      expect(result.indexSize).toBe(2);
      expect(result.matchCount).toBe(1);
      expect(result.enriched[0].narration).toBe("Coffee & Snacks | UPI debit");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("enrichWithGPay", () => {
  it("enriches matching withdrawals and leaves deposits unchanged", () => {
    const idx: GPayIndex = new Map([
      ["2026-04-24|1234.50", ["Coffee Shop"]],
      ["2026-04-24|500.00", ["Should not match deposit"]],
    ]);

    const result = enrichWithGPay(
      [
        txn({ withdrawal: 1234.5, narration: "UPI debit" }),
        txn({ deposit: 500, narration: "refund" }),
      ],
      idx,
    );

    expect(result.matchCount).toBe(1);
    expect(result.enriched.map((t) => t.narration)).toEqual([
      "Coffee Shop | UPI debit",
      "refund",
    ]);
  });

  it("allows one-day settlement skew", () => {
    const idx: GPayIndex = new Map([["2026-04-23|250.00", ["Tea Stall"]]]);

    const result = enrichWithGPay(
      [txn({ date: "2026-04-24", withdrawal: 250 })],
      idx,
    );

    expect(result.matchCount).toBe(1);
    expect(result.enriched[0].narration).toBe("Tea Stall | bank narration");
  });

  it("gives an exact-date transaction priority over an adjacent-day fallback", () => {
    const idx: GPayIndex = new Map([
      ["2026-07-17|100.00", ["NONPII PAYEE ONE"]],
      ["2026-07-16|75.00", ["NONPII PAYEE TWO"]],
    ]);

    const result = enrichWithGPay(
      [
        txn({
          date: "2026-07-16",
          withdrawal: 100,
          narration: "UPI/050505000001/ NONPII PAYEE THREE/0505051234-2",
        }),
        txn({
          date: "2026-07-16",
          withdrawal: 75,
          narration: "UPI/050505000002/ NONPII PAYEE  TWO/NONPII050505@YBL",
        }),
        txn({
          date: "2026-07-17",
          withdrawal: 100,
          narration: "UPI/050505000003/ NONPII PAYEE ONE/NONPIIPSP.050505XX",
        }),
      ],
      idx,
    );

    expect(result.matchCount).toBe(2);
    expect(result.enriched.map((transaction) => transaction.narration)).toEqual(
      [
        "UPI/050505000001/ NONPII PAYEE THREE/0505051234-2",
        "NONPII PAYEE TWO | UPI/050505000002/ NONPII PAYEE  TWO/NONPII050505@YBL",
        "NONPII PAYEE ONE | UPI/050505000003/ NONPII PAYEE ONE/NONPIIPSP.050505XX",
      ],
    );
  });

  it("does not treat differing bank and GPay names as negative evidence", () => {
    const idx: GPayIndex = new Map([
      ["2026-07-17|100.00", ["NONPII PAYEE ONE"]],
    ]);

    const result = enrichWithGPay(
      [
        txn({
          date: "2026-07-16",
          withdrawal: 100,
          narration: "UPI/050505000001/ NONPII PAYEE THREE/0505051234-2",
        }),
      ],
      idx,
    );

    expect(result.matchCount).toBe(1);
    expect(result.enriched[0].narration).toBe(
      "NONPII PAYEE ONE | UPI/050505000001/ NONPII PAYEE THREE/0505051234-2",
    );
  });

  it("uses narration names to pair same-date, same-amount activities", () => {
    const idx: GPayIndex = new Map([
      ["2026-04-24|100.00", ["First Recipient", "Second Recipient"]],
    ]);

    const result = enrichWithGPay(
      [
        txn({ withdrawal: 100, narration: "Paid SECOND RECIPIENT via UPI" }),
        txn({ withdrawal: 100, narration: "Paid FIRST RECIPIENT via UPI" }),
      ],
      idx,
    );

    expect(result.enriched.map((transaction) => transaction.narration)).toEqual(
      [
        "Second Recipient | Paid SECOND RECIPIENT via UPI",
        "First Recipient | Paid FIRST RECIPIENT via UPI",
      ],
    );
  });

  it("keeps ambiguous matches non-fatal and uses the first recipient", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const idx: GPayIndex = new Map([
      ["2026-04-24|100.00", ["First Recipient", "Second Recipient"]],
    ]);

    try {
      const result = enrichWithGPay([txn({ withdrawal: 100 })], idx);
      expect(result.matchCount).toBe(1);
      expect(result.enriched[0].narration).toBe(
        "First Recipient | bank narration",
      );
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it("does not prepend the same GPay recipient twice", () => {
    const idx: GPayIndex = new Map([["2026-04-24|100.00", ["Coffee Shop"]]]);

    const result = enrichWithGPay(
      [txn({ withdrawal: 100, narration: "Coffee Shop | UPI debit" })],
      idx,
    );

    expect(result.matchCount).toBe(0);
    expect(result.enriched[0].narration).toBe("Coffee Shop | UPI debit");
  });
});
