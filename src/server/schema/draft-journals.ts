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

export const draftTransactionsTable = sqliteTable(
  "draft_transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspace_id: text("workspace_id").notNull(),
    scoped_to_user_id: text("scoped_to_user_id").notNull(),
    date: date("date").notNull(),
    account_id: integer("account_id").references(() => accountsTable.id),
    narration: text("narration").notNull(),
    withdrawal: money("withdrawal").notNull().default(0),
    deposit: money("deposit").notNull().default(0),
    base_account_id: integer("base_account_id").references(
      () => accountsTable.id,
    ),
    balance_assertion_base_account: money("balance_assertion_base_account"),
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
    index("draft_transactions_source_key_idx").on(
      table.workspace_id,
      table.scoped_to_user_id,
      table.base_account_id,
      table.source_transaction_key,
    ),
  ],
);

export const draftTransactions = sapportaTable({
  drizzle: draftTransactionsTable,
  meta: {
    label: "Draft Transactions",
    rowLabelColumns: ["narration"],
    rowScope: "workspaceUserScoped",
    defaultSort: desc(draftTransactionsTable.date),
    search: { self: ["narration"] },
    columns: {
      workspace_id: { visuallyHidden: true },
      scoped_to_user_id: { visuallyHidden: true },
      withdrawal: { colorRule: "negative" },
      deposit: { colorRule: "positive" },
      account_id: {
        links: [
          {
            kind: "report",
            report: "account-ledger",
            bind: { account_id: "account_id" },
            label: "Category account ledger",
            icon: "report",
          },
        ],
      },
      base_account_id: {
        links: [
          {
            kind: "report",
            report: "account-ledger",
            bind: { account_id: "base_account_id" },
            label: "Base account ledger",
            icon: "report",
          },
        ],
      },
      balance_assertion_base_account: { additive: false },
      source_reference: { visuallyHidden: true },
      source_transaction_key: { visuallyHidden: true },
    },
    rowLinks: [
      {
        kind: "table",
        table: "journal_entries",
        bind: { source_transaction_key: "source_transaction_key" },
        label: "Posted journal entries",
        icon: "drill-into",
      },
    ],
  },
});
