import type { SapportaAuthContext } from "@sapporta/server";
import { createTestAuthContext } from "@sapporta/server/testing";
import { LEDGER_TABLES } from "./index.js";

/**
 * A test request's auth over the ledger's tables: one user in one workspace,
 * allowed every action.
 */
export function testLedgerAuth(
  userId = "user",
  workspaceId = "workspace",
): SapportaAuthContext {
  return createTestAuthContext({
    tables: LEDGER_TABLES,
    workspaceId,
    userId,
  });
}
