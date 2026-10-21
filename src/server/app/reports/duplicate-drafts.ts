import type Database from "better-sqlite3";
import {
  accountNameColumn,
  authorizeReport,
  dateColumn,
  flatResult,
  type GridDataset,
  hiddenIdColumn,
  moneyColumn,
  openRecordLink,
  percentColumn,
  type SapportaEnv,
  textColumn,
  TsRestApi,
  withReferenceCaptions,
} from "../../report-kit.js";
import type { LedgerAuth } from "../../modules/ledger-sql/index.js";
import { reportsContract } from "../../../shared/index.js";
import type { DuplicateDiagnostic } from "../../modules/reconciliation/index.js";
import { findDraftDuplicates } from "../../modules/drafts/index.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "duplicateDrafts",
  reportsContract.duplicateDrafts,
  async ({ c, request }) => {
    const auth = authorizeReport(c, "duplicate-drafts");
    return {
      status: 200,
      body: await withReferenceCaptions(
        c,
        duplicateDraftsReport(
          c.get("sqlite"),
          auth,
          request.query.base_account_id,
        ),
      ),
    };
  },
);

/**
 * The possible duplicates, for every account or, for Review's tab, one
 * account without the Base Account column.
 */
export function duplicateDraftsReport(
  sqlite: Database.Database,
  auth: LedgerAuth,
  accountId?: number,
): GridDataset {
  return toDuplicateDraftsResult(
    findDraftDuplicates(sqlite, auth, { accountId }),
    accountId === undefined,
  );
}

function toDuplicateDraftsResult(
  rows: DuplicateDiagnostic[],
  accountColumn: boolean,
): GridDataset {
  return flatResult(
    "duplicate-drafts",
    "Duplicate Drafts",
    {
      match: [
        hiddenIdColumn("base_account_id", "Base Account ID"),
        hiddenIdColumn("draft_account_id", "Draft Account ID"),
        hiddenIdColumn("matched_account_id", "Matched Account ID"),
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
        ...(accountColumn
          ? [
              accountNameColumn(
                "base_account",
                "Base Account",
                "base_account_id",
                { width: 34 },
              ),
            ]
          : []),
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
        accountNameColumn(
          "draft_account",
          "Draft Account",
          "draft_account_id",
          {
            width: 34,
          },
        ),
        accountNameColumn(
          "matched_account",
          "Matched Account",
          "matched_account_id",
          { width: 34 },
        ),
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
