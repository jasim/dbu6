import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileText } from "lucide-react";
import type { SortDescriptor } from "@sapporta/grid";
import type { TableSchema } from "@sapporta/shared/contracts";
import {
  fetchTableRows,
  navigateToNewRecord,
  parseTableSearchParams,
  sanitizeSortDescriptors,
  SchemaTableGridView,
  useSchemaStore,
  type SchemaTableGridViewSource,
} from "@sapporta/frontend";
import { AppPage } from "@sapporta/frontend/shell";
import { Button } from "@sapporta/ui";
import { cn } from "@sapporta/ui/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import { journalsApi } from "../api";

type RenderResult = {
  hledger_journal: string;
  journal_count: number;
};

const JOURNALS_TABLE = "journals";
const STANDARD_TABLE_PAGE_SIZE = 50;

export function JournalsTable() {
  const tableSchema = useSchemaStore((s) =>
    s.tables.find((table) => table.name === JOURNALS_TABLE),
  );
  const tables = useSchemaStore((s) => s.tables);

  if (!tableSchema) {
    return (
      <AppPage
        title="Table not found"
        bodyClassName="flex items-center justify-center text-sap-muted"
      >
        We could not find the schema for "journals".
      </AppPage>
    );
  }

  return <JournalsTableWithSchema tableSchema={tableSchema} tables={tables} />;
}

function JournalsTableWithSchema({
  tableSchema,
  tables,
}: {
  tableSchema: TableSchema;
  tables: readonly TableSchema[];
}) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
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
      path: `/tables/${JOURNALS_TABLE}`,
      searchParams,
      navigate,
    }),
    [navigate, searchParams],
  );

  async function renderCurrentTablePage() {
    setRendering(true);
    setRenderError(null);

    try {
      const visibleJournalIds = await loadCurrentTablePageJournalIds({
        tableSchema,
        searchParams,
      });
      const result =
        visibleJournalIds.length === 0
          ? { hledger_journal: "", journal_count: 0 }
          : await journalsApi.renderHledger({
              body: { journal_ids: visibleJournalIds },
            });
      setRenderResult(result as RenderResult);
    } catch (err) {
      setRenderResult(null);
      setRenderError(
        err instanceof Error ? err.message : "Failed to render journals",
      );
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="relative h-full">
      <SchemaTableGridView
        source={source}
        route={route}
        registerAs={JOURNALS_TABLE}
        onNewRecord={
          tableSchema.immutable
            ? undefined
            : () => navigateToNewRecord(tableSchema.name)
        }
        viewRelatedRows
      />
      <RenderHledgerAction
        rendering={rendering}
        onClick={renderCurrentTablePage}
      />
      <HledgerDialog
        result={renderResult}
        error={renderError}
        onOpenChange={(open) => {
          if (!open) {
            setRenderResult(null);
            setRenderError(null);
          }
        }}
      />
    </div>
  );
}

async function loadCurrentTablePageJournalIds({
  tableSchema,
  searchParams,
}: {
  tableSchema: TableSchema;
  searchParams: URLSearchParams;
}): Promise<number[]> {
  const parsed = parseTableSearchParams(searchParams, tableSchema.columns);
  const sort = parsed.sort ?? readSavedTableSort(tableSchema);
  const response = await fetchTableRows({
    tableName: tableSchema.name,
    page: parsed.page,
    limit: STANDARD_TABLE_PAGE_SIZE,
    sort,
    filters: parsed.filters,
    search: parsed.search ?? undefined,
  });

  return response.data
    .map((row) => row.id)
    .filter((id): id is number => typeof id === "number");
}

function readSavedTableSort(
  tableSchema: TableSchema,
): SortDescriptor[] | undefined {
  if (typeof window === "undefined") return undefined;
  const stored = window.localStorage.getItem(
    `sapporta:grid-sort:${tableSchema.name}`,
  );
  if (stored === null) return undefined;

  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return sanitizeSortDescriptors(
      parsed,
      new Set(tableSchema.columns.map((column) => column.name)),
    );
  } catch {
    return undefined;
  }
}

function RenderHledgerAction({
  rendering,
  onClick,
}: {
  rendering: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={rendering}
      className={cn(
        "absolute right-[190px] top-[11px] z-[var(--sap-z-shell-sticky)] inline-flex h-sap-ctl items-center gap-[6px] whitespace-nowrap rounded-[6px] border border-sap-border bg-sap-surface px-[10px] text-sap-emph font-[650] text-sap-soft shadow-sm hover:bg-sap-row-hover hover:text-sap-fg disabled:pointer-events-none disabled:opacity-40",
        "max-[980px]:right-[72px] max-[760px]:top-[8px]",
      )}
    >
      <FileText className="h-[12px] w-[12px]" />
      <span className="max-[760px]:hidden">
        {rendering ? "Rendering..." : "Render as hledger"}
      </span>
    </button>
  );
}

function HledgerDialog({
  result,
  error,
  onOpenChange,
}: {
  result: RenderResult | null;
  error: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = result !== null || error !== null;
  const text = result?.hledger_journal ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[82vh] max-w-5xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>hledger journal</DialogTitle>
          <DialogDescription>
            {result
              ? `${result.journal_count} visible journal${result.journal_count === 1 ? "" : "s"}`
              : "Render failed"}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : text ? (
          <pre className="max-h-[58vh] overflow-auto rounded-md bg-sap-nested p-3 font-mono text-xs whitespace-pre">
            {text}
          </pre>
        ) : (
          <div className="rounded-md border p-4 text-sm text-sap-muted">
            No visible journals to render.
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigator.clipboard.writeText(text)}
            disabled={!text}
          >
            Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
