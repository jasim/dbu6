import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { TableSchema } from "@sapporta/shared/contracts";
import {
  navigateToNewRecord,
  SchemaTableGridView,
  useSchemaStore,
  type SchemaTableRowsByLevel,
  type SchemaTableGridViewSource,
  type TableGridActionsProps,
} from "@sapporta/frontend";
import { AppPage } from "@sapporta/frontend/shell";
import { Button } from "../../components/ui/button";
import {
  draftTransactionQuickFilters,
  findActiveDraftTransactionQuickFilter,
  toggleDraftTransactionQuickFilter,
} from "./draft-transaction-quick-filter";

const DRAFT_TRANSACTIONS_TABLE = "draft_transactions";
// Where this grid is mounted; filters are written to its URL.
const REVIEW_ROUTE = "/review";

export function DraftTransactionsTable() {
  const tableSchema = useSchemaStore((state) =>
    state.tables.find((table) => table.name === DRAFT_TRANSACTIONS_TABLE),
  );
  const tables = useSchemaStore((state) => state.tables);

  if (!tableSchema) {
    return (
      <AppPage
        title="Table not found"
        bodyClassName="flex items-center justify-center text-sap-muted"
      >
        We could not find the schema for "draft_transactions".
      </AppPage>
    );
  }

  return (
    <DraftTransactionsTableWithSchema
      tableSchema={tableSchema}
      tables={tables}
    />
  );
}

function DraftTransactionsTableWithSchema({
  tableSchema,
  tables,
}: {
  tableSchema: TableSchema;
  tables: readonly TableSchema[];
}) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const source = useMemo<SchemaTableGridViewSource>(
    () => ({
      table: tableSchema,
      tablesByName: Object.fromEntries(
        tables.map((table) => [table.name, table]),
      ),
    }),
    [tableSchema, tables],
  );
  const route = useMemo(
    () => ({
      path: REVIEW_ROUTE,
      searchParams,
      navigate,
    }),
    [navigate, searchParams],
  );

  return (
    <SchemaTableGridView
      source={source}
      route={route}
      registerAs={DRAFT_TRANSACTIONS_TABLE}
      actions={QuickFilterButtons}
      onNewRecord={
        tableSchema.immutable
          ? undefined
          : () => navigateToNewRecord(tableSchema.name)
      }
      viewRelatedRows
    />
  );
}

function QuickFilterButtons(
  props: TableGridActionsProps<SchemaTableRowsByLevel>,
) {
  const tableSchema = useSchemaStore((state) =>
    state.tables.find((table) => table.name === DRAFT_TRANSACTIONS_TABLE),
  );
  const [searchParams] = useSearchParams();
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
              navigate(`${REVIEW_ROUTE}${query ? `?${query}` : ""}`, {
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
