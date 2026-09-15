import type Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  TsRestApi,
  type SapportaEnv,
  type ServerInferResponses,
} from "@sapporta/server";
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
import { loadCategorizedDrafts } from "./draft-categorization.js";
import { loadDraftStatus } from "./draft-status.js";
import type { RowScopeAuth } from "../bank-importer/draft-persistence.js";
import type { ScopeParams } from "./reports/shared.js";
import { requireWorkflowAuth, requireWorkflowScope } from "./workflow-auth.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "postDraftsToJournal",
  draftTransactionsContract.postDraftsToJournal,
  async ({ c, request }) => {
    const auth = requireWorkflowAuth(c);
    const scope = requireWorkflowScope(c);
    return postDraftsToJournal(
      { db: c.get("db"), sqlite: c.get("sqlite"), auth, scope },
      request.body.base_account_id,
    );
  },
);

export default api;

type PostingResponse = ServerInferResponses<
  typeof draftTransactionsContract.postDraftsToJournal,
  200 | 404 | 422
>;

export interface PostingLedger {
  db: BetterSQLite3Database;
  sqlite: Database.Database;
  auth: RowScopeAuth;
  scope: ScopeParams;
}

/**
 * Adds one account's drafts to the books: a journal per date and type, the
 * drafts deleted. Refuses while the draft status shows anything that blocks.
 */
export function postDraftsToJournal(
  { db, sqlite, auth, scope }: PostingLedger,
  base_account_id: number,
): PostingResponse {
  const loaded = loadCategorizedDrafts(db, base_account_id, auth);
  if (loaded === null) {
    return { status: 404, body: { error: "Base account not found" } };
  }

  // The same status Review shows, so its ticks and this gate agree.
  const status = loadDraftStatus(sqlite, scope, {
    accountId: base_account_id,
  }).get(base_account_id);
  if (status && status.uncategorised > 0) {
    return {
      status: 422,
      body: {
        error: `${status.uncategorised} draft transaction(s) under ${loaded.baseAccountName} have no account_id`,
        code: "UNCATEGORIZED_DRAFTS",
        uncategorized_count: status.uncategorised,
      },
    };
  }
  if (status && status.duplicates.length > 0) {
    return {
      status: 422,
      body: {
        error: `${status.duplicates.length} duplicate draft overlap(s) found under ${loaded.baseAccountName}`,
        code: "DUPLICATE_DRAFTS",
        duplicate_count: status.duplicates.length,
      },
    };
  }
  if (status && status.failing.length > 0) {
    return {
      status: 422,
      body: {
        error: `${status.failing.length} draft balance assertion(s) failing under ${loaded.baseAccountName}`,
        code: "FAILING_ASSERTIONS",
        failing_count: status.failing.length,
      },
    };
  }

  // The drafts and the status were read in one synchronous pass, so every
  // draft loaded here has a category.
  const { categorized, uncategorized } = partitionByCategorization([
    ...loaded.categorized,
  ]);
  if (uncategorized.length > 0) {
    throw new Error("Drafts changed while they were being posted.");
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
}
