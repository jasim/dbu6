import type { SapportaAuthContext } from "@sapporta/server";
import { createTestAuthContext } from "@sapporta/server/testing";
import { accounts } from "../../schema/accounts.js";
import { draftTransactions } from "../../schema/draft-journals.js";
import { importPresets } from "../../schema/import-presets.js";
import { journalEntries, journals } from "../../schema/journals.js";

/**
 * A test request's auth over the ledger's tables: one user in one workspace,
 * allowed every action.
 */
export function testLedgerAuth(
  userId = "user",
  workspaceId = "workspace",
): SapportaAuthContext {
  return createTestAuthContext({
    tables: [
      accounts,
      draftTransactions,
      journals,
      journalEntries,
      importPresets,
    ],
    workspaceId,
    userId,
  });
}
