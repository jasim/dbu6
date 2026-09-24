import { describe, expect, it } from "vitest";
import { unsafeAsChrono } from "../values/index.js";
import { planJournals, type PlanRow } from "./JournalPlan.js";

describe("JournalPlan source identity", () => {
  it("keeps keys on the counterparty leg and leaves the base leg keyless", () => {
    const row: PlanRow<number> = {
      transaction: {
        date: "2026-05-07",
        narration: "Merchant",
        withdrawal: 125.5,
        deposit: 0,
        balance: -225.5,
        source_reference: "issuer-ref",
        source_transaction_key: "stable-key",
      },
      account: 2,
      assertion: -225.5,
    };
    const [journal] = planJournals(unsafeAsChrono([row]), 1);
    expect(journal.entries[0]).toMatchObject({
      account: 2,
      sourceReference: "issuer-ref",
      sourceTransactionKey: "stable-key",
    });
    expect(journal.entries[1]).toMatchObject({
      account: 1,
      sourceReference: null,
      sourceTransactionKey: null,
    });
  });

  it("asserts a row's balance where the draft carries it, even mid-day", () => {
    // A draft added in Review after the import can follow the one carrying
    // the day's closing; the draft check tested the closing there, so the
    // books keep it there.
    const row = (
      narration: string,
      assertion: number | null,
    ): PlanRow<number> => ({
      transaction: {
        date: "2026-05-07",
        narration,
        withdrawal: 100,
        deposit: 0,
        balance: null,
      },
      account: 2,
      assertion,
    });
    const plan = planJournals(
      unsafeAsChrono([row("NOPII first", 900), row("NOPII second", null)]),
      1,
    );
    expect(plan.map((journal) => journal.entries[1].assertion)).toEqual([
      900,
      null,
    ]);
  });
});
