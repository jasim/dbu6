import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsContract } from "dbu6-shared";
import {
  duplicateDraftRowsSql,
  duplicateJournalEntryRowsSql,
  findDuplicateDiagnostics,
  type DuplicateDraftSourceRow,
  type DuplicateJournalEntrySourceRow,
} from "../../modules/reconciliation/duplicate-diagnostics.js";
import {
  allRows,
  authorizeReport,
  dateColumn,
  flatResult,
  hiddenIdColumn,
  ledgerCtes,
  moneyColumn,
  openRecordLink,
  percentColumn,
  textColumn,
} from "./shared.js";

const api = new TsRestApi<SapportaEnv>();

api.register("duplicateDrafts", reportsContract.duplicateDrafts, ({ c }) => {
  const scope = authorizeReport(c, "duplicate-drafts");
  const sqlite = c.get("sqlite");
  const drafts = allRows<DuplicateDraftSourceRow>(
    sqlite,
    `${ledgerCtes}${duplicateDraftRowsSql}`,
    scope,
  );
  const journalEntries = allRows<DuplicateJournalEntrySourceRow>(
    sqlite,
    `${ledgerCtes}${duplicateJournalEntryRowsSql}`,
    scope,
  );
  const rows = findDuplicateDiagnostics(drafts, journalEntries);

  return {
    status: 200,
    body: toDuplicateDraftsResult(rows),
  };
});

function toDuplicateDraftsResult(
  rows: ReturnType<typeof findDuplicateDiagnostics>,
): GridDataset {
  return flatResult(
    "duplicate-drafts",
    "Duplicate Drafts",
    {
      match: [
        hiddenIdColumn("base_account_id", "Base Account ID"),
        hiddenIdColumn("draft_id", "Draft ID"),
        hiddenIdColumn("other_draft_id", "Other Draft ID"),
        hiddenIdColumn("matched_journal_id", "Journal ID"),
        hiddenIdColumn("matched_journal_entry_id", "Journal Entry ID"),
        dateColumn("date", "Date", { width: 12 }),
        textColumn("match_kind", "Overlap", { width: 18 }),
        textColumn("match_type", "Match Type", {
          width: 26,
          links: [
            openRecordLink(
              "journal_entries",
              "matched_journal_entry_id",
              "Open matched journal entry",
            ),
          ],
        }),
        percentColumn("confidence", "Confidence", { width: 14 }),
        textColumn("base_account", "Base Account", { width: 34 }),
        textColumn("direction", "Direction", { width: 14 }),
        moneyColumn("amount", "Amount", { width: 16 }),
        textColumn("narration", "Draft Narration", {
          width: 50,
          links: [
            openRecordLink(
              "draft_transactions",
              "draft_id",
              "Open draft transaction",
            ),
          ],
        }),
        textColumn("other_narration", "Matched Narration", {
          width: 50,
          links: [
            openRecordLink(
              "draft_transactions",
              "other_draft_id",
              "Open matched draft",
            ),
            openRecordLink(
              "journals",
              "matched_journal_id",
              "Open matched journal",
            ),
          ],
        }),
        textColumn("draft_category", "Draft Category", { width: 34 }),
        textColumn("matched_category", "Matched Category", { width: 34 }),
        textColumn("source_reference", "Source Reference", { width: 30 }),
        textColumn("source_transaction_key", "Source Key", { width: 44 }),
        textColumn("other_source_reference", "Matched Reference", {
          width: 30,
        }),
        textColumn("other_source_transaction_key", "Matched Source Key", {
          width: 44,
        }),
      ],
    },
    rows,
    {
      rowKey: (row, index) =>
        `duplicate:${row.draft_id}:${row.other_draft_id ?? row.matched_journal_entry_id}:${index}`,
      rowLinks: [
        openRecordLink("accounts", "base_account_id", "Open base account"),
      ],
    },
  );
}

export default api;
