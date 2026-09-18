import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { draftTransactionsContract } from "dbu6-shared";
import { formatHledger, planJournals } from "../modules/journal-plan/index.js";
import { loadCategorizedDrafts } from "../modules/drafts/index.js";
import type { LedgerAuth } from "../modules/ledger-sql/index.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

export interface DraftHledger {
  hledger_journal: string;
  transaction_count: number;
  base_account: string;
}

// One account's drafts as the journals posting would write, by account name.
// Null when the account doesn't exist.
export function renderDraftHledger(
  db: BetterSQLite3Database,
  baseAccountId: number,
  auth: LedgerAuth,
): DraftHledger | null {
  const loaded = loadCategorizedDrafts(db, baseAccountId, auth);
  if (loaded === null) return null;

  return {
    hledger_journal: formatHledger(
      planJournals(loaded.categorized, loaded.baseAccount),
    ),
    transaction_count: loaded.drafts.length,
    base_account: loaded.baseAccountName,
  };
}

const api = new TsRestApi<SapportaEnv>();

api.register(
  "renderDraftHledger",
  draftTransactionsContract.renderDraftHledger,
  ({ c, request }) => {
    const auth = requireWorkflowAuth(c);
    const rendered = renderDraftHledger(
      c.get("db"),
      request.query.base_account_id,
      auth,
    );
    if (rendered === null) {
      return { status: 404, body: { error: "Base account not found" } };
    }
    return { status: 200, body: rendered };
  },
);

export default api;
