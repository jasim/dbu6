import { describe, expect, it } from "vitest";
import type { Abacus } from "../statement/index.js";
import { fromGroups } from "./JournalPlan.js";

describe("JournalPlan source identity", () => {
  it("keeps keys on itemized legs and leaves the aggregated base leg keyless", () => {
    const transaction: { transaction: Abacus; accountId: number } = {
      transaction: {
        date: "2026-05-07",
        narration: "Merchant",
        withdrawal: 125.5,
        deposit: 0,
        balance: -225.5,
        source_reference: "issuer-ref",
        source_transaction_key: "stable-key",
      },
      accountId: 2,
    };
    const [journal] = fromGroups(
      [
        {
          date: "2026-05-07",
          type: "withdrawal",
          transactions: [transaction],
          endOfGroupBalance: -225.5,
        },
      ],
      1,
    );
    expect(journal.entries[0]).toMatchObject({
      account_id: 2,
      source_reference: "issuer-ref",
      source_transaction_key: "stable-key",
    });
    expect(journal.entries[1]).toMatchObject({
      account_id: 1,
      source_reference: null,
      source_transaction_key: null,
    });
  });
});
