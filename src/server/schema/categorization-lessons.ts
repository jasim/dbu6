import { sqliteTable, integer, index } from "drizzle-orm/sqlite-core";
import { sapportaTable, text, timestamp } from "@sapporta/server/table";
import { Temporal } from "@sapporta/shared/temporal";
import { accountsTable } from "./accounts.js";

/*
 * What the user taught the categoriser on Review's Improve categorization
 * tab: drafts of one statement account, the account they go to, and a note
 * for next time. A lesson waits here until the user's coding agent has turned
 * it into a rule or guidance, and the agent then deletes it. Rows are written
 * only through `/categorization-lessons` (app/categorization-lessons.ts): the
 * table API can read them and nothing else, as with import_presets.
 *
 * The narrations are copied from the drafts, which are gone once posted. A
 * lesson about an account that is deleted goes with it.
 */
export const categorizationLessonsTable = sqliteTable(
  "categorization_lessons",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspace_id: text("workspace_id").notNull(),
    scoped_to_user_id: text("scoped_to_user_id").notNull(),
    // The statement account the drafts were imported for.
    base_account_id: integer("base_account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    // Where the user said they go.
    account_id: integer("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    /** JSON: the drafts' narrations, `string[]`. */
    narrations: text("narrations").notNull(),
    // What the user added for next time, or "".
    note: text("note").notNull().default(""),
    created_at: timestamp("created_at")
      .$defaultFn(() => Temporal.Now.instant())
      .notNull(),
  },
  (table) => [
    index("categorization_lessons_base_account_idx").on(
      table.workspace_id,
      table.scoped_to_user_id,
      table.base_account_id,
    ),
  ],
);

export const categorizationLessons = sapportaTable({
  drizzle: categorizationLessonsTable,
  meta: {
    label: "Categorization lessons",
    rowLabelColumns: ["note"],
    rowScope: "workspaceUserScoped",
    immutable: true,
    columns: {
      workspace_id: { visuallyHidden: true },
      scoped_to_user_id: { visuallyHidden: true },
    },
  },
});
