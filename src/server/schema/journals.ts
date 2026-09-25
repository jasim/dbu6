import { desc } from "drizzle-orm";
import { sqliteTable, integer, index } from "drizzle-orm/sqlite-core";
import {
  date,
  money,
  sapportaTable,
  text,
  timestamp,
} from "@sapporta/server/table";
import { Temporal } from "@sapporta/shared/temporal";
import { accountsTable } from "./accounts.js";

export const journalsTable = sqliteTable("journals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspace_id: text("workspace_id").notNull(),
  scoped_to_user_id: text("scoped_to_user_id").notNull(),
  date: date("date").notNull(),
  description: text("description").notNull(),
  created_at: timestamp("created_at")
    .$defaultFn(() => Temporal.Now.instant())
    .notNull(),
  updated_at: timestamp("updated_at")
    .$defaultFn(() => Temporal.Now.instant())
    .notNull(),
});

export const journalEntriesTable = sqliteTable(
  "journal_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspace_id: text("workspace_id").notNull(),
    scoped_to_user_id: text("scoped_to_user_id").notNull(),
    journal_id: integer("journal_id")
      .notNull()
      .references(() => journalsTable.id),
    account_id: integer("account_id")
      .notNull()
      .references(() => accountsTable.id),
    debit: money("debit").notNull().default(0),
    credit: money("credit").notNull().default(0),
    account_balance_assertion: money("account_balance_assertion"),
    comment: text("comment"),
    source_reference: text("source_reference"),
    source_transaction_key: text("source_transaction_key"),
    created_at: timestamp("created_at")
      .$defaultFn(() => Temporal.Now.instant())
      .notNull(),
    updated_at: timestamp("updated_at")
      .$defaultFn(() => Temporal.Now.instant())
      .notNull(),
  },
  (table) => [
    // A journal's lines and an account's lines are what the ledger's
    // correlated subqueries look up (opening entries, last reconciled).
    index("journal_entries_journal_idx").on(table.journal_id),
    index("journal_entries_account_idx").on(table.account_id),
    index("journal_entries_source_key_idx").on(
      table.workspace_id,
      table.scoped_to_user_id,
      table.source_transaction_key,
    ),
  ],
);

export const journals = sapportaTable({
  drizzle: journalsTable,
  meta: {
    label: "Journals",
    rowLabelColumns: ["description"],
    rowScope: "workspaceUserScoped",
    defaultSort: desc(journalsTable.date),
    search: { self: ["description"] },
    children: [
      {
        table: "journal_entries",
        foreignKey: "journal_id",
        label: "Entries",
        defaultSort: "id",
      },
    ],
    columns: {
      workspace_id: { visuallyHidden: true },
      scoped_to_user_id: { visuallyHidden: true },
    },
  },
});

export const journalEntries = sapportaTable({
  drizzle: journalEntriesTable,
  meta: {
    label: "Journal Entries",
    rowLabelColumns: ["comment"],
    rowScope: "workspaceUserScoped",
    search: { self: ["comment"] },
    columns: {
      workspace_id: { visuallyHidden: true },
      scoped_to_user_id: { visuallyHidden: true },
      account_id: {
        links: [
          {
            kind: "report",
            report: "account-ledger",
            bind: { account_id: "account_id" },
            label: "Account ledger",
            icon: "report",
          },
        ],
      },
      debit: { colorRule: "positive" },
      credit: { colorRule: "negative" },
      account_balance_assertion: { additive: false, strong: true },
      comment: { textDisplay: "multiLine" },
      source_reference: { visuallyHidden: true },
      source_transaction_key: { visuallyHidden: true },
    },
    rowLinks: [
      {
        kind: "table",
        table: "draft_transactions",
        bind: { source_transaction_key: "source_transaction_key" },
        label: "Source drafts",
        icon: "drill-into",
      },
    ],
  },
});
