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
});
