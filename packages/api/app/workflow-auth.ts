import type { Context } from "hono";
import { forbidUnless, type SapportaEnv } from "@sapporta/server";
import type { RowScopeAuth } from "../bank-importer/draft-persistence.js";

export function requireWorkflowAuth(c: Context<SapportaEnv>): RowScopeAuth {
  const auth = c.get("auth");
  forbidUnless(c, auth.ability.can("manage", "all"));
  return auth as RowScopeAuth;
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
