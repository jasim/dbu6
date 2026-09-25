import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import {
  SchemaTableGridView,
  useSchemaStore,
  type SchemaTableGridViewSource,
  type SchemaTableRowsByLevel,
  type TGridSession,
} from "@sapporta/frontend";
import { LookupPicker, useTableLookup } from "@sapporta/frontend/lookup";
import { rowKeyOfRowId } from "@sapporta/grid";
import { eqCondition, mintFilterId } from "@sapporta/shared/filter";
import { apiErrorMessage, draftTransactionsApi } from "../api";
import { AgentPrompt } from "../components/agent-prompt";
import { Button } from "../components/ui/button";
import { plural } from "../format";
import { IMPORT_INSTRUCTIONS_ROUTE } from "../views/import-instructions/ImportInstructions";
import {
  lessonsPrompt,
  useCategorizationLessons,
  type CategorizationLesson,
} from "./categorization-lessons";
import { useReviewAccount } from "./ReviewAccount";
import { IMPROVE_CATEGORIZATION_TAB, reviewHref } from "./routes";

const DRAFT_TRANSACTIONS_TABLE = "draft_transactions";
// The fixed filters hold both columns to one value.
const HIDDEN_COLUMNS = [
  "base_account_id",
  "account_id",
  "created_at",
  "updated_at",
];
// Repeat payees sit together, so a run of them is one shift-click.
const BY_NARRATION = [{ colId: "narration", direction: "asc" }] as const;
// Narrations shown for a selection before the rest are counted.
const SHOWN_SELECTED = 4;

/** A draft the user selected in the grid. */
interface SelectedDraft {
  id: number;
  narration: string;
}

/**
 * Improve categorization: the account's drafts with no category, by
 * narration. The user selects some, says which account they go to and what
 * would help next time, and each such lesson sets the drafts' category and
 * joins a list. The list goes to the user's coding agent, which decides how
 * each lesson becomes a rule or guidance; nothing in user-config/ changes
 * until then.
 */
export function ImproveCategorizationTab() {
  const { detail, refresh } = useReviewAccount();
  const accountId = detail.account.account_id;
  const tableSchema = useSchemaStore((state) =>
    state.tables.find((table) => table.name === DRAFT_TRANSACTIONS_TABLE),
  );
  const tables = useSchemaStore((state) => state.tables);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const lessons = useCategorizationLessons(accountId);

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
    () => ({
      path: reviewHref(accountId, IMPROVE_CATEGORIZATION_TAB),
      searchParams,
      navigate,
    }),
    [accountId, navigate, searchParams],
  );
  // A new object would recreate the grid's session, so it is kept per account.
  const rootRows = useMemo(
    () => ({
      fixedFilters: [
        eqCondition("base_account_id", String(accountId)),
        {
          id: mintFilterId("account_id", "is"),
          column: "account_id",
          op: "is" as const,
          polarity: "null" as const,
        },
      ],
      initialSort: BY_NARRATION,
    }),
    [accountId],
  );

  // The grid owns the selection; the panel follows it.
  const [selected, setSelected] = useState<SelectedDraft[]>([]);
  const session = useRef<TGridSession<SchemaTableRowsByLevel> | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const sessionRef = useCallback(
    (current: TGridSession<SchemaTableRowsByLevel> | null) => {
      unsubscribe.current?.();
      unsubscribe.current = null;
      session.current = current;
      if (current === null) {
        setSelected([]);
        return;
      }
      const level = current.runtime.root;
      const read = () =>
        setSelected(
          level
            .selectedRowIds()
            .flatMap((rowId) =>
              selectedDraft(current.getLoadedRow(rowKeyOfRowId(rowId))),
            ),
        );
      unsubscribe.current = level.subscribeSelectedRowIds(read);
      read();
    },
    [],
  );

  const added = () => {
    session.current?.runtime.root.clearRowSelection();
    void session.current?.reloadRows();
    refresh();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="h-[60vh] min-h-0 min-w-0 flex-1 [--sap-page-header-inset:0px] md:h-auto">
        {source ? (
          <SchemaTableGridView
            source={source}
            route={route}
            registerAs={DRAFT_TRANSACTIONS_TABLE}
            header="toolbar"
            hiddenColumns={HIDDEN_COLUMNS}
            rootRows={rootRows}
            sessionRef={sessionRef}
          />
        ) : (
          <p className="px-3 py-5 text-body text-ink-meta sm:px-4">
            We could not find the schema for "draft_transactions".
          </p>
        )}
      </div>
      <aside
        aria-label="Teach the categoriser"
        className="shrink-0 space-y-5 overflow-y-auto border-sap-border px-4 py-4 max-md:border-t md:w-[360px] md:border-l"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-row font-semibold text-foreground">
            Teach the categoriser
          </h2>
          <Link
            to={`${IMPORT_INSTRUCTIONS_ROUTE}?${new URLSearchParams({ account: String(accountId) })}`}
            className="shrink-0 text-meta text-primary hover:underline"
          >
            See all rules and guidance
          </Link>
        </div>
        <SelectionPanel
          selected={selected}
          onAdded={(lesson) => {
            lessons.add(lesson);
            added();
          }}
        />
        <LessonList
          lessons={lessons.lessons}
          remove={lessons.remove}
          clear={lessons.clear}
          prompt={lessonsPrompt(detail, lessons.lessons)}
        />
      </aside>
    </div>
  );
}

/** A loaded grid row as the draft the panel shows, or none. */
function selectedDraft(row: unknown): SelectedDraft[] {
  if (typeof row !== "object" || row === null) return [];
  const { id, narration } = row as Record<string, unknown>;
  return typeof id === "number" && typeof narration === "string"
    ? [{ id, narration }]
    : [];
}

function SelectionPanel({
  selected,
  onAdded,
}: {
  selected: readonly SelectedDraft[];
  onAdded: (lesson: CategorizationLesson) => void;
}) {
  const accountLookup = useTableLookup<number>("accounts");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [missingAccount, setMissingAccount] = useState(false);
  const setCategory = useMutation({
    mutationFn: (chosen: number) =>
      draftTransactionsApi.setDraftsCategory({
        body: { ids: selected.map((draft) => draft.id), account_id: chosen },
      }),
  });

  if (selected.length === 0) {
    return (
      <p className="rounded-control border border-dashed border-sap-border px-3 py-3 text-meta text-ink-meta">
        Select drafts in the grid to say where they go. Shift-click selects a
        run of them.
      </p>
    );
  }

  const add = () => {
    if (accountId === null) {
      setMissingAccount(true);
      return;
    }
    const name =
      accountLookup.valueLookup.entryForValue(accountId)?.label ??
      `account ${accountId}`;
    setCategory.mutate(accountId, {
      onSuccess: () => {
        onAdded({
          narrations: selected.map((draft) => draft.narration),
          account: { id: accountId, name },
          note: note.trim(),
        });
        // The next selection starts with an empty form.
        setAccountId(null);
        setNote("");
      },
    });
  };

  const rest = selected.length - SHOWN_SELECTED;
  return (
    <section className="space-y-3 rounded-card border border-sap-border bg-card px-3 py-3">
      <div>
        <p className="text-meta text-ink-meta">
          {plural(selected.length, "draft")} selected
        </p>
        <ul className="mt-1 space-y-0.5">
          {selected.slice(0, SHOWN_SELECTED).map((draft) => (
            <li
              key={draft.id}
              className="truncate font-mono text-meta text-foreground"
              title={draft.narration}
            >
              {draft.narration}
            </li>
          ))}
        </ul>
        {rest > 0 && (
          <p className="mt-0.5 text-meta text-ink-meta">and {rest} more</p>
        )}
      </div>
      <div className="space-y-1">
        <label
          htmlFor="lesson-account"
          className="block text-meta font-medium text-foreground"
        >
          Should go to
        </label>
        <LookupPicker
          id="lesson-account"
          lookup={accountLookup}
          value={accountId}
          onChange={(id) => {
            setAccountId(id);
            setMissingAccount(false);
          }}
          placeholder="Choose an account…"
          disabled={setCategory.isPending}
          ariaInvalid={missingAccount}
          ariaDescribedBy={missingAccount ? "lesson-account-error" : undefined}
          className="w-full"
        />
        {missingAccount && (
          <p id="lesson-account-error" className="text-meta text-destructive">
            Choose the account these drafts go to.
          </p>
        )}
      </div>
      <label className="block space-y-1">
        <span className="block text-meta font-medium text-foreground">
          Anything that helps next time{" "}
          <span className="font-normal text-ink-meta">(optional)</span>
        </span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          placeholder="A food delivery app; its payments are always Food."
          className="block w-full rounded-control border border-sap-border bg-card px-3 py-2 text-meta text-foreground placeholder:text-ink-meta"
        />
      </label>
      {setCategory.isError && (
        <p className="text-meta text-destructive [overflow-wrap:anywhere]">
          {apiErrorMessage(setCategory.error)}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={setCategory.isPending}
          onClick={add}
        >
          Add to list
        </Button>
      </div>
    </section>
  );
}

function LessonList({
  lessons,
  remove,
  clear,
  prompt,
}: {
  lessons: readonly CategorizationLesson[];
  remove: (index: number) => void;
  clear: () => void;
  prompt: string;
}) {
  if (lessons.length === 0) {
    return (
      <p className="text-meta text-ink-meta">
        Drafts you add get their category now, and wait here for your coding
        agent to turn them into rules and guidance for the next import.
      </p>
    );
  }
  return (
    <section className="space-y-3">
      <h3 className="text-meta font-medium text-foreground">
        To teach{" "}
        <span className="tnum font-mono text-ink-meta">{lessons.length}</span>
      </h3>
      <ol className="divide-y divide-sap-border rounded-card border border-sap-border bg-card">
        {lessons.map((lesson, index) => (
          <li key={index} className="flex gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 gap-1.5 text-meta">
                <span
                  className="truncate font-mono text-foreground"
                  title={lesson.narrations.join("\n")}
                >
                  {lesson.narrations[0]}
                </span>
                {lesson.narrations.length > 1 && (
                  <span className="shrink-0 text-ink-meta">
                    +{lesson.narrations.length - 1}
                  </span>
                )}
              </p>
              <p className="text-meta text-ink-soft">
                → {lesson.account.name}
              </p>
              {lesson.note !== "" && (
                <p className="text-meta text-ink-meta [overflow-wrap:anywhere]">
                  {lesson.note}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => remove(index)}
              title="Remove from the list. The drafts keep their category."
              aria-label={`Remove the lesson for ${lesson.narrations[0]}`}
              className="self-start rounded-control p-1 text-ink-meta hover:bg-sap-row-hover hover:text-foreground"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </li>
        ))}
      </ol>
      <AgentPrompt
        title={`Teach the categoriser ${plural(lessons.length, "lesson")}`}
        prompt={prompt}
        afterwards={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Once your agent has made the changes, clear the list.</span>
            <Button type="button" size="sm" variant="outline" onClick={clear}>
              Clear list
            </Button>
          </div>
        }
      />
    </section>
  );
}
