import type { Context } from "hono";
import { forbidUnless, type SapportaEnv } from "@sapporta/server";
import type { LedgerAuth } from "../modules/ledger-sql/index.js";

export function requireWorkflowAuth(c: Context<SapportaEnv>): LedgerAuth {
  const auth = c.get("auth");
  forbidUnless(c, auth.ability.can("manage", "all"));
  return auth;
}

export function requireWorkflowScope(c: Context<SapportaEnv>): {
  workspaceId: string;
  userId: string;
} {
  const auth = c.get("auth");
  const scope = auth.dataAuthority.rowAuthorities.workspaceUserScoped;
  forbidUnless(c, scope !== null && scope !== undefined);
  if (!scope) {
    throw new Error("Workflow requires workspace/user scoped data authority.");
  }
  return {
    workspaceId: scope.workspace.id,
    userId: scope.user.id,
  };
}
