import { asc } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  uniqueIndex,
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

export type AccountType = (typeof accountTypeOptions)[number];

export const accountsTable = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspace_id: text("workspace_id").notNull(),
    scoped_to_user_id: text("scoped_to_user_id").notNull(),
    // A plain name, such as "Dining Out", without its parents'. Mapping
    // rules and the LLM name an account by it, so it is unique in a user's
    // books. Import presets name an account by its id instead.
    name: text("name").notNull(),
    // Triggers (migrations/0004_account_tree_rules.sql) keep the parent in the
    // same workspace, user and account type, and refuse a loop.
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
  },
  (table) => [
    uniqueIndex("accounts_name_unique").on(
      table.workspace_id,
      table.scoped_to_user_id,
      table.name,
    ),
  ],
);

export const accounts = sapportaTable({
  drizzle: accountsTable,
  meta: {
    label: "Accounts",
    rowLabelColumns: ["name"],
    rowScope: "workspaceUserScoped",
    // The Accounts page shows one indented tree; siblings sort by name.
    tree: { parentColumn: "parent_id" },
    defaultSort: asc(accountsTable.name),
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
