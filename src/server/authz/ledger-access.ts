import type { SapportaAuthContext } from "@sapporta/server";

/**
 * Whether an auth may read and write the ledger for `may`: `may` allows it
 * and the auth acts for one user in a workspace, the scope every ledger
 * table's rows are owned in. The routes' guards and `dbu6 check` ask this.
 */
export function ledgerAuthAllows(
  auth: Pick<SapportaAuthContext, "ability" | "dataAuthority">,
  may: (ability: SapportaAuthContext["ability"]) => boolean,
): boolean {
  return (
    may(auth.ability) &&
    auth.dataAuthority.rowAuthorities.workspaceUserScoped != null
  );
}

/**
 * What the owner's workflows (imports, review, posting) take, and the
 * owner's routes off the ledger (`requireOwner`).
 */
export function mayRunOwnerWorkflows(
  ability: SapportaAuthContext["ability"],
): boolean {
  return ability.can("manage", "all");
}
