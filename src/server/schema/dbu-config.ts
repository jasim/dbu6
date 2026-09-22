import { sqliteTable } from "drizzle-orm/sqlite-core";
import { sapportaTable, text, timestamp } from "@sapporta/server/table";
import { Temporal } from "@sapporta/shared/temporal";

/*
 * What dbu6 found out about the machine it runs on and keeps across restarts,
 * one JSON value per key (dbu-config.ts). It belongs to the machine, not to a
 * workspace or a user, so its rows are system-global. Only dbu6 writes it,
 * directly: the table API can read it, and the owner's ability forbids
 * creating rows (authz/ability.ts), which `immutable` alone would allow.
 */
export const dbuConfigTable = sqliteTable("dbu_config", {
  key: text("key").primaryKey(),
  /** JSON; its shape is the reader's, checked when read. */
  value: text("value").notNull(),
  updated_at: timestamp("updated_at")
    .$defaultFn(() => Temporal.Now.instant())
    .notNull(),
});

export const dbuConfig = sapportaTable({
  drizzle: dbuConfigTable,
  meta: {
    label: "dbu6 config",
    rowLabelColumns: ["key"],
    rowScope: "systemGlobal",
    immutable: true,
  },
});
