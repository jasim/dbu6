import { createContext, useContext, useEffect, useMemo, useState } from "react";
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
  type SchemaTableRowsByLevel,
  type SchemaTableGridViewSource,
  type TableGridActionsProps,
  type TGridSession,
} from "@sapporta/frontend";
import { AppPage } from "@sapporta/frontend/shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import { journalsApi } from "../api";
import { Button } from "../components/ui/button";

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

// The table header renders `actions` as a component of its own, so the
// render state reaches it through context rather than props: a component
// type created per render would remount the header's controls.
const RenderHledgerContext = createContext<{
  rendering: boolean;
  onClick: () => void;
} | null>(null);

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
  const [session, setSession] =
    useState<TGridSession<SchemaTableRowsByLevel> | null>(null);
  const singleJournalId = useMemo(
    () => singleJournalIdFromUrl(searchParams, tableSchema),
    [searchParams, tableSchema],
  );
  useExpandJournal(session, singleJournalId);
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
    <RenderHledgerContext.Provider
      value={{ rendering, onClick: renderCurrentTablePage }}
    >
      <SchemaTableGridView
        source={source}
        route={route}
        registerAs={JOURNALS_TABLE}
        sessionRef={setSession}
        actions={RenderHledgerAction}
        onNewRecord={
          tableSchema.immutable
            ? undefined
            : () => navigateToNewRecord(tableSchema.name)
        }
        viewRelatedRows
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
    </RenderHledgerContext.Provider>
  );
}

/**
 * The journal the URL asks for by id, as "Open journal" links from the
 * ledgers and reports do, or null when the page lists journals.
 */
function singleJournalIdFromUrl(
  searchParams: URLSearchParams,
  tableSchema: TableSchema,
): string | null {
  const { filters } = parseTableSearchParams(searchParams, tableSchema.columns);
  const byId = filters.find(
    (condition) => condition.column === "id" && condition.op === "eq",
  );
  return byId && "value" in byId ? String(byId.value) : null;
}

/**
 * Opens the one journal the page was asked for, so its entries show without
 * a click. It opens once per journal, when its row arrives; collapsing it
 * afterwards sticks.
 */
function useExpandJournal(
  session: TGridSession<SchemaTableRowsByLevel> | null,
  journalId: string | null,
) {
  useEffect(() => {
    if (!session || journalId === null) return;
    const root = session.runtime.root;
    let unsubscribe = () => {};
    const expandOnceLoaded = () => {
      const row = root
        .displayedRows()
        .rows.find(
          (row) => row.kind === "data" && String(row.columns.id) === journalId,
        );
      if (!row) return;
      unsubscribe();
      root.expand(row.id);
    };
    unsubscribe = root.subscribeDisplayedRowSequence(expandOnceLoaded);
    expandOnceLoaded();
    return () => unsubscribe();
  }, [session, journalId]);
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

function RenderHledgerAction(
  props: TableGridActionsProps<SchemaTableRowsByLevel>,
) {
  const action = useContext(RenderHledgerContext);
  if (!action) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={action.rendering}
      className={
        props.surface === "toolbar" ? undefined : "w-full justify-start"
      }
      onClick={() => {
        action.onClick();
        if (props.surface === "action-sheet") props.close();
      }}
    >
      <FileText />
      <span
        className={
          props.surface === "toolbar" ? "max-[760px]:hidden" : undefined
        }
      >
        {action.rendering ? "Rendering..." : "Render as hledger"}
      </span>
    </Button>
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
          <div className="rounded-card border border-destructive/30 bg-destructive/10 p-3 text-row text-destructive">
            {error}
          </div>
        ) : text ? (
          <pre className="tnum max-h-[58vh] overflow-auto rounded-control bg-muted p-3 font-mono text-meta whitespace-pre">
            {text}
          </pre>
        ) : (
          <div className="rounded-card border p-3 text-row text-ink-meta">
            No visible journals to render.
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigator.clipboard.writeText(text)}
            waiting={text ? undefined : "Nothing to copy"}
          >
            Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
