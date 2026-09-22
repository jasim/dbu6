import type { Context } from "hono";
import {
  forbidUnless,
  type SapportaAuthContext,
  type SapportaEnv,
} from "@sapporta/server";
import type { Ledger, LedgerAuth } from "../modules/ledger-sql/index.js";

/**
 * The request's auth for reading and writing the ledger: forbidden unless
 * `may` allows the action and the request acts for one user in a workspace,
 * the scope every ledger table's rows are owned in.
 */
export function requireLedgerAuth(
  c: Context<SapportaEnv>,
  may: (ability: SapportaAuthContext["ability"]) => boolean,
): LedgerAuth {
  const auth = c.get("auth");
  forbidUnless(
    c,
    may(auth.ability) &&
      auth.dataAuthority.rowAuthorities.workspaceUserScoped != null,
  );
  return auth;
}

/** The ledger's auth for the owner's workflows: imports, review, posting. */
export function requireWorkflowAuth(c: Context<SapportaEnv>): LedgerAuth {
  return requireLedgerAuth(c, (ability) => ability.can("manage", "all"));
}

/** The ledger an owner's workflow runs on, once the request may run it. */
export function requireWorkflowLedger(c: Context<SapportaEnv>): Ledger {
  const auth = requireWorkflowAuth(c);
  return { db: c.get("db"), sqlite: c.get("sqlite"), auth };
}

/** Forbidden unless the request is the owner's; for routes off the ledger. */
export function requireOwner(c: Context<SapportaEnv>): void {
  forbidUnless(c, c.get("auth").ability.can("manage", "all"));
}
