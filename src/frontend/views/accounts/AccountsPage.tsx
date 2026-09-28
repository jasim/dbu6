import { useMemo } from "react";
import { Link, Outlet, useNavigate, useSearchParams } from "react-router-dom";
import { Pencil } from "lucide-react";
import {
  openResolvedLink,
  SchemaTableGridView,
  useSchemaStore,
  type SchemaTableColumns,
  type SchemaTableGridViewSource,
  type SchemaTableRowsByLevel,
  type TGridCellRenderContext,
} from "@sapporta/frontend";
import { parseRowId } from "../../row-id";
import { ACCOUNTS_ROUTE, NEW_ACCOUNT_ROUTE, editAccountHref } from "./routes";

/*
 * The Accounts page: the chart as one tree, read-only, with an Edit button on
 * every row that opens the one form that changes an account (AccountDialog).
 * A rename, a move and a type change are the same write, and a type change
 * takes the account's whole branch with it, so the grid may not save one cell
 * at a time.
 *
 * The generated table API is untouched: `npx sapporta rows update accounts …`
 * still writes one cell at a time, which is what an agent wants.
 *
 * Which form is open is the URL's, not this page's: `/accounts/new` and
 * `/accounts/:accountId/edit` are its child routes, rendered in the Outlet
 * below, so a form can be linked to, bookmarked and reloaded. The chart stays
 * mounted behind them — the same session, on the same page of rows — and
 * Close steps back to it as it was.
 */

const ACCOUNTS_TABLE = "accounts";

/** The one action a chart row has. */
const EDIT_ACCOUNT = "Edit account";

/*
 * The chart's columns, made once at module scope rather than per render. The
 * grid keeps one session per definition and the columns are part of it, so a
 * builder made fresh on every render would tear the chart down and build it
 * again — the page, the expanded rows and where the user had scrolled all
 * gone — every time this page re-rendered for any reason at all.
 */
const ACCOUNT_COLUMNS: SchemaTableColumns = (c) => [
  c.remainingTable(),
  c.client("edit", {
    // The header stays empty: every row already says Edit.
    label: "",
    width: "content",
    renderCell: EditCell,
    activation: {
      // The pointer uses the cell's own link; Enter needs an activation,
      // since the grid owns the keyboard. The framework's own cell links do
      // the same.
      startsOn: ["enter"],
      describe: EDIT_ACCOUNT,
      run: (ctx) => {
        const id = accountIdOf(ctx.row);
        if (id !== null) {
          openResolvedLink({ href: editAccountHref(id), target: "_self" });
        }
      },
    },
  }),
];

export function AccountsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const accountsSchema = useSchemaStore((state) =>
    state.tables.find((table) => table.name === ACCOUNTS_TABLE),
  );
  const tables = useSchemaStore((state) => state.tables);

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
  // The grid writes its page, filters, sort and search to this URL. A form's
  // route takes the chart's place in the address bar without saying anything
  // about them, and the grid reads that silence as "leave the view as it is".
  const route = useMemo(
    () => ({ path: ACCOUNTS_ROUTE, searchParams, navigate }),
    [navigate, searchParams],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col [--sap-page-header-inset:0px]">
      {source ? (
        <SchemaTableGridView
          source={source}
          route={route}
          registerAs={ACCOUNTS_TABLE}
          columns={ACCOUNT_COLUMNS}
          onNewRecord={() => void navigate(NEW_ACCOUNT_ROUTE)}
          viewRelatedRows
          gridClassName="accounts-grid"
        />
      ) : (
        <p className="px-3 py-5 text-body text-ink-meta sm:px-4">
          We could not find the schema for "accounts".
        </p>
      )}
      {/* The open form, as `/accounts/new` or `/accounts/:accountId/edit`. */}
      <Outlet />
    </div>
  );
}

/**
 * The Edit button a row shows: the pencil and the word, so the action reads
 * as one. It is a real link — a form is a place, and a copied address or a
 * new tab is how a place is used — while the cell keeps the keyboard gesture
 * through its activation.
 */
function EditCell({
  row,
}: TGridCellRenderContext<SchemaTableRowsByLevel, unknown, string>) {
  const id = accountIdOf(row);
  if (id === null) return null;
  return (
    <Link
      to={editAccountHref(id)}
      // The grid moves focus itself; the cell's activation carries Enter.
      tabIndex={-1}
      className="account-edit-cell"
      aria-label={EDIT_ACCOUNT}
      title={EDIT_ACCOUNT}
      onClick={(event) => event.stopPropagation()}
    >
      <Pencil aria-hidden="true" className="size-3" />
      Edit
    </Link>
  );
}

/** The account a grid row is, for its form's URL. */
function accountIdOf(row: Readonly<Record<string, unknown>>): number | null {
  return parseRowId(String(row.id));
}
