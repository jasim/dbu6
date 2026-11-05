import type { Context } from "hono";
import {
  requestDataAuthority,
  systemGlobalOnlyAuthority,
  type RequestDataAuthority,
  workspaceGlobalOnlyAuthority,
  workspaceUserScopedAuthority,
} from "@sapporta/server";
import type { AppPrincipal } from "./types.js";

/**
 * Chooses the trusted ownership facts this request may use.
 *
 * The starter app keeps anonymous requests limited to system-wide tables and
 * signed-in requests limited to the user's own rows in the active workspace.
 * For a public workspace feature, first verify that the requested workspace has
 * enabled that feature, then return workspace-global authority for that route.
 */
export async function resolveRequestDataAuthority(input: {
  principal: AppPrincipal;
  c: Context;
}): Promise<RequestDataAuthority> {
  return dataAuthorityFor(input.principal);
}

/**
 * The ownership facts a principal's requests get, with no request: what
 * `dbu6 check` reads the books with, as the agent token's owner.
 */
export function dataAuthorityFor(
  principal: AppPrincipal,
): RequestDataAuthority {
  if (principal.kind !== "user") {
    return requestDataAuthority({
      systemGlobalOnly: systemGlobalOnlyAuthority(),
    });
  }
  const workspace = principal.membership.workspace;
  return requestDataAuthority({
    systemGlobalOnly: systemGlobalOnlyAuthority(),
    workspaceGlobalOnly: workspaceGlobalOnlyAuthority(workspace),
    workspaceUserScoped: workspaceUserScopedAuthority({
      workspace,
      user: principal.user,
    }),
  });
}
