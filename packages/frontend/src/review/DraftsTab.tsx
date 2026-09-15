import { useMemo } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  SchemaTableGridView,
  useSchemaStore,
  type SchemaTableGridViewSource,
  type SchemaTableRowsByLevel,
  type TableGridActionsProps,
} from "@sapporta/frontend";
import { eqCondition } from "@sapporta/shared/filter";
import { Button } from "../components/ui/button";
import {
  draftTransactionQuickFilters,
  findActiveDraftTransactionQuickFilter,
  toggleDraftTransactionQuickFilter,
} from "./draft-transaction-quick-filter";
import { useReviewAccount } from "./ReviewAccount";
import { reviewHref } from "./routes";

const DRAFT_TRANSACTIONS_TABLE = "draft_transactions";

/**
 * The Drafts tab (PLAN.md §11 P3): the draft table as it has always been,
 * locked to this account. The lock is a fixed filter, so it is neither a
 * chip nor removable; the user's own filters, search and page stay in the
 * tab's URL.
 */
export function DraftsTab() {
  const { detail } = useReviewAccount();
  const accountId = detail.account.account_id;
  const tableSchema = useSchemaStore((state) =>
    state.tables.find((table) => table.name === DRAFT_TRANSACTIONS_TABLE),
  );
  const tables = useSchemaStore((state) => state.tables);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const source = useMemo<SchemaTableGridViewSource | null>(
    () =>
      tableSchema
        ? {
            table: tableSchema,
            tablesByName: Object.fromEntries(
              tables.map((table) => [table.name, table]),
            ),
          }
        : null,
    [tableSchema, tables],
  );
  const route = useMemo(
    () => ({ path: reviewHref(accountId, "drafts"), searchParams, navigate }),
    [accountId, navigate, searchParams],
  );
  // A new array would recreate the grid's session, so it is kept per account.
  const rootRows = useMemo(
    () => ({
      fixedFilters: [eqCondition("base_account_id", String(accountId))],
    }),
    [accountId],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-5 pt-5 sm:px-8 lg:px-14">
        <Button
          render={<Link to="/views/reclassify-drafts" />}
          nativeButton={false}
          variant="outline"
          size="sm"
        >
          Run the categoriser again
        </Button>
      </div>
      {/* The frame's header already clears the sidebar toggle. */}
      <div className="mt-4 min-h-0 flex-1 border-t border-sap-border [--sap-page-header-inset:0px]">
        {source ? (
          <SchemaTableGridView
            source={source}
            route={route}
            registerAs={DRAFT_TRANSACTIONS_TABLE}
            actions={QuickFilterButtons}
            rootRows={rootRows}
            viewRelatedRows
          />
        ) : (
          <p className="px-5 py-8 text-body text-ink-meta sm:px-8 lg:px-14">
            We could not find the schema for "draft_transactions".
          </p>
        )}
      </div>
    </div>
  );
}

function QuickFilterButtons(
  props: TableGridActionsProps<SchemaTableRowsByLevel>,
) {
  const tableSchema = useSchemaStore((state) =>
    state.tables.find((table) => table.name === DRAFT_TRANSACTIONS_TABLE),
  );
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  if (!tableSchema) return null;

  const activeFilter = findActiveDraftTransactionQuickFilter(
    searchParams,
    tableSchema,
  );

  return (
    <>
      {draftTransactionQuickFilters.map((filter) => {
        const active = activeFilter?.id === filter.id;

        return (
          <Button
            key={filter.id}
            type="button"
            size="sm"
            variant={active ? "default" : "outline"}
            aria-pressed={active}
            className={
              props.surface === "toolbar" ? undefined : "w-full justify-start"
            }
            onClick={() => {
              const next = toggleDraftTransactionQuickFilter(
                filter.id,
                searchParams,
                tableSchema,
              );
              const query = next.toString();
              // The tab's own URL: the quick filters stay on this account.
              navigate(`${pathname}${query ? `?${query}` : ""}`, {
                replace: true,
              });
              if (props.surface === "action-sheet") props.close();
            }}
          >
            {filter.label}
          </Button>
        );
      })}
    </>
  );
}
