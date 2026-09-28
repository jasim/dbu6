import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Pencil } from "lucide-react";
import {
  SchemaTableGridView,
  useSchemaStore,
  type SchemaTableColumns,
  type SchemaTableGridViewSource,
  type SchemaTableRowsByLevel,
  type TGridCellRenderContext,
} from "@sapporta/frontend";
import {
  LEDGER_ACCOUNT_TYPES,
  type LedgerAccountType,
} from "../../../shared/index";
import { AccountDialog } from "./AccountDialog";
import type { AccountRow } from "./account-form";

/*
 * The Accounts page: the chart as one tree, read-only, with an Edit button on
 * every row that opens the one form that changes an account (AccountDialog).
 * A rename, a move and a type change are the same write, and a type change
 * takes the account's whole branch with it, so the grid may not save one cell
 * at a time.
 *
 * The generated table API is untouched: `sapporta rows update accounts …`
 * still writes one cell at a time, which is what an agent wants.
 */

const ACCOUNTS_TABLE = "accounts";

export function AccountsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const accountsSchema = useSchemaStore((state) =>
    state.tables.find((table) => table.name === ACCOUNTS_TABLE),
  );
  const tables = useSchemaStore((state) => state.tables);
  const [editing, setEditing] = useState<AccountRow | "new" | null>(null);

  /*
   * Sapporta's only UI read-only switch is `table.immutable`: it removes cell
   * edits, the draft row, "Add child row", the delete control and the detail
   * sheet's editing. The server schema and the generated table API are
   * untouched. A column-level `gridEditable: false` is not enough — it leaves
   * the draft row, "Add child row" and delete in place — and this page's own
   * Edit button and New record action are what replace them.
   */
  const readOnlyAccounts = useMemo(
    () => (accountsSchema ? { ...accountsSchema, immutable: true } : null),
    [accountsSchema],
  );
  const source = useMemo<SchemaTableGridViewSource | null>(
    () =>
      readOnlyAccounts
        ? {
            table: readOnlyAccounts,
            // Each level's table is compiled from this map, so the accounts
            // entry has to be the read-only copy too: `source.table` alone
            // would leave the grid editing cells.
            tablesByName: {
              ...Object.fromEntries(tables.map((table) => [table.name, table])),
              [ACCOUNTS_TABLE]: readOnlyAccounts,
            },
          }
        : null,
    [readOnlyAccounts, tables],
  );
  const route = useMemo(
    () => ({ path: "/accounts", searchParams, navigate }),
    [navigate, searchParams],
  );
  // A new list rebuilds the grid, and `setEditing` is a state setter, whose
  // identity never changes — so this list is made once and never depends on
  // anything.
  const columns = useMemo<SchemaTableColumns>(
    () => (c) => [
      c.remainingTable(),
      c.client("edit", {
        // The header stays empty: every row already says Edit.
        label: "",
        width: "content",
        renderCell: EditButtonCell,
        activation: {
          startsOn: ["click", "enter"],
          describe: "Edit account",
          run: (ctx) => setEditing(accountOf(ctx.row)),
        },
      }),
    ],
    [],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col [--sap-page-header-inset:0px]">
      {source ? (
        <SchemaTableGridView
          source={source}
          route={route}
          registerAs={ACCOUNTS_TABLE}
          columns={columns}
          onNewRecord={() => setEditing("new")}
          viewRelatedRows
          gridClassName="accounts-grid"
        />
      ) : (
        <p className="px-3 py-5 text-body text-ink-meta sm:px-4">
          We could not find the schema for "accounts".
        </p>
      )}
      <AccountDialog editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

/**
 * The Edit button a row shows: the pencil and the word, so the action reads
 * as one. The cell owns the click and Enter gestures, so this button hands
 * the click to the activation itself and stops it reaching the cell, which
 * would run the same activation a second time.
 */
function EditButtonCell({
  activation,
}: TGridCellRenderContext<SchemaTableRowsByLevel, unknown, string>) {
  const label = activation?.label ?? "Edit account";
  return (
    <button
      type="button"
      className="account-edit-cell"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        void activation?.run();
      }}
    >
      <Pencil aria-hidden="true" className="size-3" />
      Edit
    </button>
  );
}

/** A grid row as the account it is, for the form. */
function accountOf(row: Readonly<Record<string, unknown>>): AccountRow {
  const account_type = row.account_type;
  return {
    id: Number(row.id),
    name: String(row.name),
    parent_id: row.parent_id === null ? null : Number(row.parent_id),
    account_type: (typeof account_type === "string" &&
    (LEDGER_ACCOUNT_TYPES as readonly string[]).includes(account_type)
      ? account_type
      : "Asset") as LedgerAccountType,
  };
}
