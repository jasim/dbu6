import { AbilityBuilder, createMongoAbility } from "@casl/ability";
import type { AppAbility, AppAuthFacts } from "./types.js";

/**
 * Defines what this requester may do.
 *
 * No rule means no access. Generated table routes ask for actions such as
 * `read`, `create`, and `export` on the table name. Custom routes can use
 * feature subjects such as `quote_publication` and then apply their own row
 * predicates through `auth.rowSecurity`.
 */
export function buildAbility(ctx: AppAuthFacts): AppAbility {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(
    createMongoAbility,
  );

  if (ctx.principal.kind === "user") {
    can("read", "agent_access_token");
    can("create", "agent_access_token");
    can("delete", "agent_access_token");
  }

  if (
    ctx.principal.kind === "user" &&
    ctx.principal.membership.roles.includes("owner")
  ) {
    // This allows owner actions; row security still limits database rows to the
    // request's trusted ownership facts.
    can("manage", "all");
    // dbu6 writes what it found out about the machine itself (dbu-config.ts);
    // through the table API the owner can only look.
    cannot(["create", "update", "delete"], "dbu_config");
    // Presets change only through POST /import-presets/changes, which checks
    // the whole table (schema/import-presets.ts).
    cannot(["create", "update", "delete"], "import_presets");
    // Lessons are written only through /categorization-lessons, which sets
    // the drafts' category with them (schema/categorization-lessons.ts).
    cannot(["create", "update", "delete"], "categorization_lessons");
  }

  return build();
}
