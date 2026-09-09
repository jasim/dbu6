import { describe, expect, it } from "vitest";
import {
  findDuplicateDiagnostics,
  type DuplicateDraftSourceRow,
  type DuplicateJournalEntrySourceRow,
} from "./duplicate-diagnostics.js";

const draft = (
  overrides: Partial<DuplicateDraftSourceRow> = {},
): DuplicateDraftSourceRow => ({
  draft_id: 1,
  date: "2026-05-07",
  narration: "Merchant",
  withdrawal: 125.5,
  deposit: 0,
  account_id: 2,
  base_account_id: 10,
  source_reference: null,
  source_transaction_key: null,
  base_account: "cc:stanc",
  draft_category: "expenses:software",
  ...overrides,
});

describe("findDuplicateDiagnostics", () => {
  it("reports draft-draft duplicates even when categories differ", () => {
    const rows = findDuplicateDiagnostics(
      [
        draft(),
        draft({
          draft_id: 2,
          account_id: 3,
          draft_category: "expenses:office",
        }),
      ],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      match_kind: "draft-draft",
      match_type: "legacy-draft",
      draft_id: 1,
      other_draft_id: 2,
      draft_category: "expenses:software",
      matched_category: "expenses:office",
    });
  });

  it("reports a grouped journal match through its itemized leg", () => {
    const entries: DuplicateJournalEntrySourceRow[] = [
      {
        journal_id: 20,
        date: "2026-05-07",
        journal_description: "Expenses",
        entry_id: 201,
        account_id: 2,
        debit: 125.5,
        credit: 0,
        comment: "Merchant",
        source_reference: null,
        source_transaction_key: null,
        account: "expenses:software",
      },
      {
        journal_id: 20,
        date: "2026-05-07",
        journal_description: "Expenses",
        entry_id: 202,
        account_id: 3,
        debit: 50,
        credit: 0,
        comment: "Other",
        source_reference: null,
        source_transaction_key: null,
        account: "expenses:office",
      },
      {
        journal_id: 20,
        date: "2026-05-07",
        journal_description: "Expenses",
        entry_id: 203,
        account_id: 10,
        debit: 0,
        credit: 175.5,
        comment: null,
        source_reference: null,
        source_transaction_key: null,
        account: "cc:stanc",
      },
    ];
    expect(findDuplicateDiagnostics([draft()], entries)[0]).toMatchObject({
      match_kind: "draft-journal",
      match_type: "itemized-journal-leg",
      matched_journal_id: 20,
      matched_journal_entry_id: 201,
    });
  });
});
