import { sqliteTable, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sapportaTable, text, timestamp } from "@sapporta/server/table";
import { Temporal } from "@sapporta/shared/temporal";

/*
 * Import presets, one row per institution: the saved parsers that read its
 * statements and the ledger accounts they import into (`ImportInstitution`
 * in src/shared/contracts/import-presets.ts). Every write goes through
 * `POST /import-presets/changes`, which checks the rules over the whole
 * table, so the table API can read it and nothing else: `immutable` hides
 * the generated update and delete, and the owner's ability forbids creating
 * rows (authz/ability.ts), which `immutable` alone would allow.
 */
export const importPresetsTable = sqliteTable(
  "import_presets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspace_id: text("workspace_id").notNull(),
    scoped_to_user_id: text("scoped_to_user_id").notNull(),
    // The institution's name, such as "Sample Bank".
    name: text("name").notNull(),
    /** JSON: the saved parsers' directory names, `string[]`. */
    parsers: text("parsers").notNull(),
    /** JSON: `ImportAccount[]`, each naming a ledger account by its id. */
    accounts: text("accounts").notNull(),
    updated_at: timestamp("updated_at")
      .$defaultFn(() => Temporal.Now.instant())
      .notNull(),
  },
  (table) => [
    uniqueIndex("import_presets_name_unique").on(
      table.workspace_id,
      table.scoped_to_user_id,
      table.name,
    ),
  ],
);

export const importPresets = sapportaTable({
  drizzle: importPresetsTable,
  meta: {
    label: "Import presets",
    rowLabelColumns: ["name"],
    rowScope: "workspaceUserScoped",
    immutable: true,
    columns: {
      workspace_id: { visuallyHidden: true },
      scoped_to_user_id: { visuallyHidden: true },
    },
  },
});
