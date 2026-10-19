import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  enrichWithGPay,
  parseGPayHtml,
  type GPayActivity,
  type GPayIndex,
} from "./GPayIndex.js";
import type { Abacus } from "../statement/index.js";

// Activities that name no account, as an older Takeout prints them.
function paid(...recipients: string[]): GPayActivity[] {
  return recipients.map((recipient) => ({ recipient, paidFrom: null }));
}

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
      expect(idx.get("2026-04-24|1234.50")).toEqual(paid("Coffee & Snacks"));
      expect(idx.get("2026-04-25|99.00")).toEqual(paid("Metro Card"));

      const result = enrichWithGPay(
        [txn({ withdrawal: 1234.5, narration: "UPI debit" })],
        idx,
        null,
      );
      expect(idx.size).toBe(2);
      expect(result.matchCount).toBe(1);
      expect(result.enriched[0].narration).toBe("Coffee & Snacks | UPI debit");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the digits of the account each payment was made from", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gpay-test-"));
    const file = path.join(dir, "takeout.html");
    writeFileSync(
      file,
      `
        <div>Paid ₹100.00 to Sample Cafe using Bank Account XXXXXXX0505</div>
        <div>Apr 24, 2026, 10:15 AM</div>
      `,
    );

    try {
      expect(parseGPayHtml(file).get("2026-04-24|100.00")).toEqual([
        { recipient: "Sample Cafe", paidFrom: "0505" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("enrichWithGPay", () => {
  const statementAccount = {
    kind: "bank",
    identifier: "0505050000121234",
  } as const;

  it("does not name a row with a payment made from another account", () => {
    const idx: GPayIndex = new Map([
      ["2026-04-24|75.00", [{ recipient: "Sample Store", paidFrom: "0505" }]],
    ]);

    const result = enrichWithGPay(
      [txn({ withdrawal: 75 })],
      idx,
      statementAccount,
    );

    expect(result.matchCount).toBe(0);
    expect(result.recipients).toEqual([null]);
  });

  it("names a row with a payment made from the statement's account", () => {
    const idx: GPayIndex = new Map([
      [
        "2026-04-24|75.00",
        [
          { recipient: "Sample Store", paidFrom: "0505" },
          { recipient: "Sample Stall", paidFrom: "1234" },
        ],
      ],
    ]);

    const result = enrichWithGPay(
      [txn({ withdrawal: 75 })],
      idx,
      statementAccount,
    );

    expect(result.recipients).toEqual(["Sample Stall"]);
  });

  it("matches across accounts when the statement prints no account", () => {
    const idx: GPayIndex = new Map([
      ["2026-04-24|75.00", [{ recipient: "Sample Store", paidFrom: "0505" }]],
    ]);

    const result = enrichWithGPay([txn({ withdrawal: 75 })], idx, null);

    expect(result.recipients).toEqual(["Sample Store"]);
  });

  it("enriches matching withdrawals and leaves deposits unchanged", () => {
    const idx: GPayIndex = new Map([
      ["2026-04-24|1234.50", paid("Coffee Shop")],
      ["2026-04-24|500.00", paid("Should not match deposit")],
    ]);

    const result = enrichWithGPay(
      [
        txn({ withdrawal: 1234.5, narration: "UPI debit" }),
        txn({ deposit: 500, narration: "refund" }),
      ],
      idx,
      null,
    );

    expect(result.matchCount).toBe(1);
    expect(result.enriched.map((t) => t.narration)).toEqual([
      "Coffee Shop | UPI debit",
      "refund",
    ]);
    expect(result.recipients).toEqual(["Coffee Shop", null]);
  });

  it("names the recipient of a row already prefixed, without prefixing it again", () => {
    const idx: GPayIndex = new Map([
      ["2026-04-24|250.00", paid("Sample Stall")],
    ]);

    const result = enrichWithGPay(
      [txn({ withdrawal: 250, narration: "Sample Stall | UPI debit" })],
      idx,
      null,
    );

    expect(result.matchCount).toBe(0);
    expect(result.enriched[0].narration).toBe("Sample Stall | UPI debit");
    expect(result.recipients).toEqual(["Sample Stall"]);
  });

  it("allows one-day settlement skew", () => {
    const idx: GPayIndex = new Map([["2026-04-23|250.00", paid("Tea Stall")]]);

    const result = enrichWithGPay(
      [txn({ date: "2026-04-24", withdrawal: 250 })],
      idx,
      null,
    );

    expect(result.matchCount).toBe(1);
    expect(result.enriched[0].narration).toBe("Tea Stall | bank narration");
  });

  it("gives an exact-date transaction priority over an adjacent-day fallback", () => {
    const idx: GPayIndex = new Map([
      ["2026-07-17|100.00", paid("NONPII PAYEE ONE")],
      ["2026-07-16|75.00", paid("NONPII PAYEE TWO")],
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
      null,
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
      ["2026-07-17|100.00", paid("NONPII PAYEE ONE")],
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
      null,
    );

    expect(result.matchCount).toBe(1);
    expect(result.enriched[0].narration).toBe(
      "NONPII PAYEE ONE | UPI/050505000001/ NONPII PAYEE THREE/0505051234-2",
    );
  });

  it("uses narration names to pair same-date, same-amount activities", () => {
    const idx: GPayIndex = new Map([
      ["2026-04-24|100.00", paid("First Recipient", "Second Recipient")],
    ]);

    const result = enrichWithGPay(
      [
        txn({ withdrawal: 100, narration: "Paid SECOND RECIPIENT via UPI" }),
        txn({ withdrawal: 100, narration: "Paid FIRST RECIPIENT via UPI" }),
      ],
      idx,
      null,
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
      ["2026-04-24|100.00", paid("First Recipient", "Second Recipient")],
    ]);

    try {
      const result = enrichWithGPay([txn({ withdrawal: 100 })], idx, null);
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
    const idx: GPayIndex = new Map([
      ["2026-04-24|100.00", paid("Coffee Shop")],
    ]);

    const result = enrichWithGPay(
      [txn({ withdrawal: 100, narration: "Coffee Shop | UPI debit" })],
      idx,
      null,
    );

    expect(result.matchCount).toBe(0);
    expect(result.enriched[0].narration).toBe("Coffee Shop | UPI debit");
  });
});
