import {
  sqliteTable,
  integer,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sapportaTable, select, text, timestamp } from "@sapporta/server/table";
import { Temporal } from "@sapporta/shared/temporal";

const accountTypeOptions = [
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Expense",
] as const;

export const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspace_id: text("workspace_id").notNull(),
  scoped_to_user_id: text("scoped_to_user_id").notNull(),
  name: text("name").notNull(),
  parent_id: integer("parent_id").references(
    (): AnySQLiteColumn => accountsTable.id,
  ),
  account_type: select("account_type", accountTypeOptions).notNull(),
  created_at: timestamp("created_at")
    .$defaultFn(() => Temporal.Now.instant())
    .notNull(),
  updated_at: timestamp("updated_at")
    .$defaultFn(() => Temporal.Now.instant())
    .notNull(),
});

export const accounts = sapportaTable({
  drizzle: accountsTable,
  meta: {
    label: "Accounts",
    rowLabelColumns: ["name"],
    rowScope: "workspaceUserScoped",
    search: { self: ["name"] },
    columns: {
      workspace_id: { visuallyHidden: true },
      scoped_to_user_id: { visuallyHidden: true },
      name: {
        links: [
          {
            kind: "report",
            report: "account-ledger",
            bind: { account_id: "id" },
            label: "Account ledger",
            icon: "report",
          },
        ],
      },
    },
    rowLinks: [
      {
        kind: "table",
        table: "accounts",
        bind: { parent_id: "id" },
        label: "Sub-accounts",
        icon: "drill-into",
      },
      {
        kind: "table",
        table: "journal_entries",
        bind: { account_id: "id" },
        label: "Journal entries",
        icon: "drill-into",
      },
      {
        kind: "table",
        table: "draft_transactions",
        bind: { base_account_id: "id" },
        label: "Imported drafts",
        icon: "drill-into",
      },
      {
        kind: "table",
        table: "draft_transactions",
        bind: { account_id: "id" },
        label: "Drafts categorized here",
        icon: "drill-into",
      },
    ],
  },
});
