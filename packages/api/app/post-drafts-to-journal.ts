import { eq } from "drizzle-orm";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { parsePlainDate } from "@sapporta/shared/temporal";
import { draftTransactionsContract } from "dbu6-shared";
import { unsafeAsChrono } from "../bank-importer/domain/Chrono.js";
import { partitionByCategorization } from "../bank-importer/domain/DraftCategorizedTransaction.js";
import { groupByDateAndType } from "../bank-importer/domain/TransactionGroup.js";
import { fromGroups as planFromGroups } from "../bank-importer/domain/JournalPlan.js";
import {
  draftTransactions,
  draftTransactionsTable,
} from "../schema/draft-journals.js";
import {
  journalEntries,
  journalEntriesTable,
  journals,
  journalsTable,
} from "../schema/journals.js";
import { allRows, ledgerCtes } from "./reports/shared.js";
import { loadCategorizedDrafts } from "./draft-categorization.js";
import {
  baseAccountRunningBalanceCtes,
  failingDraftAssertionsSelect,
} from "../modules/reconciliation/running-balance.js";
import {
  duplicateDraftRowsSql,
  duplicateJournalEntryRowsSql,
  findDuplicateDiagnostics,
  type DuplicateDraftSourceRow,
  type DuplicateJournalEntrySourceRow,
} from "../modules/reconciliation/duplicate-diagnostics.js";
import { requireWorkflowAuth, requireWorkflowScope } from "./workflow-auth.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "postDraftsToJournal",
  draftTransactionsContract.postDraftsToJournal,
  async ({ c, request }) => {
    const auth = requireWorkflowAuth(c);
    const scope = requireWorkflowScope(c);
    const { base_account_id } = request.body;
    const db = c.get("db");

    const loaded = loadCategorizedDrafts(db, base_account_id, auth);
    if (loaded === null) {
      return { status: 404, body: { error: "Base account not found" } };
    }

    const { categorized, uncategorized } = partitionByCategorization([
      ...loaded.categorized,
    ]);
    if (uncategorized.length > 0) {
      return {
        status: 422,
        body: {
          error: `${uncategorized.length} draft transaction(s) under ${loaded.baseAccountName} have no account_id`,
          code: "UNCATEGORIZED_DRAFTS",
          uncategorized_count: uncategorized.length,
        },
      };
    }

    const duplicateDraftRows = allRows<DuplicateDraftSourceRow>(
      c.get("sqlite"),
      `${ledgerCtes}${duplicateDraftRowsSql}
       AND dt.base_account_id = @baseAccountId`,
      { ...scope, baseAccountId: base_account_id },
    );
    const duplicateJournalRows = allRows<DuplicateJournalEntrySourceRow>(
      c.get("sqlite"),
      `${ledgerCtes}${duplicateJournalEntryRowsSql}`,
      scope,
    );
    const duplicates = findDuplicateDiagnostics(
      duplicateDraftRows,
      duplicateJournalRows,
    );
    if (duplicates.length > 0) {
      return {
        status: 422,
        body: {
          error: `${duplicates.length} duplicate draft overlap(s) found under ${loaded.baseAccountName}`,
          code: "DUPLICATE_DRAFTS",
          duplicate_count: duplicates.length,
        },
      };
    }

    const failing = allRows<{ draft_id: number }>(
      c.get("sqlite"),
      `${ledgerCtes}${baseAccountRunningBalanceCtes}
      SELECT r.draft_id
      FROM (${failingDraftAssertionsSelect}) r
      WHERE r.account_id = @baseAccountId
        AND r.draft_id IS NOT NULL`,
      { ...scope, baseAccountId: base_account_id },
    );
    if (failing.length > 0) {
      return {
        status: 422,
        body: {
          error: `${failing.length} draft balance assertion(s) failing under ${loaded.baseAccountName}`,
          code: "FAILING_ASSERTIONS",
          failing_count: failing.length,
        },
      };
    }

    const groups = groupByDateAndType(unsafeAsChrono(categorized));
    const plan = planFromGroups(groups, base_account_id);
    const journalAccess = auth.rowSecurity.forTable(journals);
    const entryAccess = auth.rowSecurity.forTable(journalEntries);
    const draftAccess = auth.rowSecurity.forTable(draftTransactions);

    const stats = db.transaction((tx: any) => {
      let journalCount = 0;
      let entryCount = 0;

      for (const insert of plan) {
        const journalValues = journalAccess.insertValuesSync(tx, {
          date: parsePlainDate(insert.date),
          description: insert.description,
        });
        const journal = tx
          .insert(journalsTable)
          .values(journalValues)
          .returning({ id: journalsTable.id })
          .get();

        const entryValues = insert.entries.map((entry) =>
          entryAccess.insertValuesSync(tx, {
            journal_id: journal.id,
            account_id: entry.account_id,
            debit: Number(entry.debit),
            credit: Number(entry.credit),
            account_balance_assertion:
              entry.account_balance_assertion === null
                ? null
                : Number(entry.account_balance_assertion),
            comment: entry.comment,
            source_reference: entry.source_reference,
            source_transaction_key: entry.source_transaction_key,
          }),
        );
        tx.insert(journalEntriesTable).values(entryValues).run();

        journalCount++;
        entryCount += insert.entries.length;
      }

      tx.delete(draftTransactionsTable)
        .where(
          draftAccess.ownedRows(
            eq(draftTransactionsTable.base_account_id, base_account_id),
          ),
        )
        .run();

      return { journalCount, entryCount };
    });

    return {
      status: 200,
      body: {
        base_account: loaded.baseAccountName,
        journals_created: stats.journalCount,
        entries_created: stats.entryCount,
        drafts_posted: loaded.drafts.length,
      },
    };
  },
);

export default api;
