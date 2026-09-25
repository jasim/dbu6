import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import {
  SchemaTableGridView,
  useSchemaStore,
  type SchemaTableGridViewSource,
  type SchemaTableRowsByLevel,
  type TGridSession,
} from "@sapporta/frontend";
import { LookupPicker, useTableLookup } from "@sapporta/frontend/lookup";
import {
  ROW_MULTISELECT_LIST,
  rowKeyOfRowId,
  type GridInteractionConfig,
} from "@sapporta/grid";
import {
  eqCondition,
  mintFilterId,
  type FilterCondition,
} from "@sapporta/shared/filter";
import { apiErrorMessage, categorizationLessonsApi } from "../api";
import { AgentActions, PromptText } from "../components/agent-prompt";
import { Disclosure } from "../components/disclosure";
import { Button } from "../components/ui/button";
import { plural } from "../format";
import { categorizationLessonsQuery } from "../queries";
import { Chip } from "../views/import-instructions/rule-parts";
import { categorizationRulesHref } from "../views/import-instructions/routes";
import type { CategorizationLesson } from "../../shared/index";
import { lessonsPrompt } from "./categorization-lessons";
import { useReviewAccount } from "./ReviewAccount";
import {
  IMPROVE_CATEGORIZATION_TAB,
  reviewHref,
  RUN_CATEGORIZER_TAB,
  withReviewRun,
} from "./routes";

const DRAFT_TRANSACTIONS_TABLE = "draft_transactions";
// The fixed filters hold both account columns to one value, and the id and
// running balance say nothing about where a draft goes.
const HIDDEN_COLUMNS = [
  "id",
  "base_account_id",
  "account_id",
  "balance_assertion_base_account",
  "created_at",
  "updated_at",
];
// Repeat payees sit together, so a run of them is one shift-click.
const BY_NARRATION = [{ colId: "narration", direction: "asc" }] as const;
// Whole rows, never cells: a click selects the row, Shift-click the run up
// to it, and nothing in the grid is editable.
const SELECT_ROWS = {
  ...ROW_MULTISELECT_LIST,
  activeRow: {
    ...ROW_MULTISELECT_LIST.activeRow,
    activation: { startsOn: ["click"] },
  },
} satisfies GridInteractionConfig;
// Descriptions shown on a rule before the rest are counted.
const SHOWN_DESCRIPTIONS = 3;

/** A draft the user selected in the grid. */
interface SelectedDraft {
  id: number;
  narration: string;
}

/**
 * Improve categorization: new rules on the left, the account's drafts with
 * no category on the right, by narration. The user selects drafts that go
 * together, which makes a draft rule; choosing its account adds it to the
 * new rules, kept in the books as lessons, and takes its drafts off the list.
 * Nothing is categorised here: the user hands the new rules to their coding
 * agent, which turns each into a rule or guidance and takes it off the list,
 * and then runs the categorizer, where this sends them.
 */
export function ImproveCategorizationTab() {
  const { detail, setup } = useReviewAccount();
  const accountId = detail.account.account_id;
  const tableSchema = useSchemaStore((state) =>
    state.tables.find((table) => table.name === DRAFT_TRANSACTIONS_TABLE),
  );
  const tables = useSchemaStore((state) => state.tables);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const lessonsQuery = categorizationLessonsQuery(accountId);
  const lessons = useQuery(lessonsQuery);
  const refreshLessons = () =>
    void queryClient.invalidateQueries({ queryKey: lessonsQuery.queryKey });

  // The grid is for selecting drafts; editing and deleting them is the Drafts
  // tab's, so here the table reads as immutable and offers neither.
  const source = useMemo<SchemaTableGridViewSource | null>(() => {
    if (!tableSchema) return null;
    const table = { ...tableSchema, immutable: true };
    return {
      table,
      tablesByName: {
        ...Object.fromEntries(tables.map((each) => [each.name, each])),
        [table.name]: table,
      },
    };
  }, [tableSchema, tables]);
  const route = useMemo(
    () => ({
      path: reviewHref(accountId, IMPROVE_CATEGORIZATION_TAB),
      searchParams,
      navigate,
    }),
    [accountId, navigate, searchParams],
  );
  // A draft in a new rule leaves the list. Lessons keep narrations, not
  // drafts, so the list leaves out every draft with one of them. A new object
  // recreates the grid's session, so it is kept per account and new rules.
  const queued = useMemo(
    () => [...new Set(lessons.data?.flatMap((lesson) => lesson.narrations))],
    [lessons.data],
  );
  const queuedKey = JSON.stringify(queued);
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
        // One condition each, since a list value can't hold a comma.
        ...queued.map((narration): FilterCondition => ({
          id: mintFilterId("narration", "neq"),
          column: "narration",
          op: "neq",
          value: narration,
        })),
      ],
      initialSort: BY_NARRATION,
    }),
    [accountId, queuedKey],
  );

  // The grid owns the selection; the draft rule follows it.
  const [selected, setSelected] = useState<SelectedDraft[]>([]);
  const session = useRef<TGridSession<SchemaTableRowsByLevel> | null>(null);
  const unsubscribe = useRef<(() => void)[]>([]);
  const sessionRef = useCallback(
    (current: TGridSession<SchemaTableRowsByLevel> | null) => {
      for (const each of unsubscribe.current) each();
      unsubscribe.current = [];
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
      unsubscribe.current = [
        level.subscribeSelectedRowIds(read),
        // A plain click only moves the row cursor in a row list; here it
        // selects the row too.
        current.runtime.on("rowActivated", ({ activeRow }) =>
          activeRow.level.selectRow(activeRow.row.id),
        ),
      ];
      read();
    },
    [],
  );

  const runCategorizerHref = withReviewRun(
    reviewHref(accountId, RUN_CATEGORIZER_TAB),
    { setup },
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside
        aria-labelledby="new-rules-heading"
        className="shrink-0 space-y-4 overflow-y-auto border-sap-border px-4 py-4 max-md:order-last max-md:border-t md:w-[380px] md:border-r"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2
            id="new-rules-heading"
            className="text-subheading text-foreground"
          >
            New rules
            {lessons.data && lessons.data.length > 0 && (
              <span className="tnum ml-2 text-meta font-medium text-ink-meta">
                {lessons.data.length}
              </span>
            )}
          </h2>
          <Link
            to={categorizationRulesHref("ai", accountId)}
            className="text-meta text-ink-meta hover:text-foreground hover:underline"
          >
            All rules
          </Link>
        </div>
        <DraftRule
          selected={selected}
          uncategorised={detail.account.uncategorised}
          inNewRules={
            lessons.data?.reduce(
              (sum, lesson) => sum + lesson.narrations.length,
              0,
            ) ?? 0
          }
          onAdded={refreshLessons}
        />
        {lessons.isError ? (
          <p className="text-meta text-destructive [overflow-wrap:anywhere]">
            {apiErrorMessage(lessons.error)}
          </p>
        ) : (
          lessons.data &&
          lessons.data.length > 0 && (
            <NewRules
              lessons={lessons.data}
              onChanged={refreshLessons}
              prompt={lessonsPrompt(detail, lessons.data)}
              runCategorizerHref={runCategorizerHref}
              onHandedOver={() => navigate(runCategorizerHref)}
            />
          )
        )}
      </aside>
      <div className="h-[60vh] min-h-0 min-w-0 flex-1 [--sap-page-header-inset:0px] [--sap-selection:var(--sap-brand-soft)] md:h-auto">
        {!source ? (
          <p className="px-3 py-5 text-body text-ink-meta sm:px-4">
            We could not find the schema for "draft_transactions".
          </p>
        ) : (
          // Until the new rules load, the list can't leave their drafts out.
          lessons.data && (
            <SchemaTableGridView
              source={source}
              route={route}
              registerAs={DRAFT_TRANSACTIONS_TABLE}
              header="toolbar"
              hiddenColumns={HIDDEN_COLUMNS}
              rootRows={rootRows}
              interaction={SELECT_ROWS}
              sessionRef={sessionRef}
            />
          )
        )}
      </div>
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

/**
 * A rule's descriptions as chips, each once, the first few and a count of the
 * rest.
 */
function Descriptions({ narrations: all }: { narrations: readonly string[] }) {
  const narrations = [...new Set(all)];
  const rest = narrations.length - SHOWN_DESCRIPTIONS;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {narrations.slice(0, SHOWN_DESCRIPTIONS).map((narration, index) => (
        <Chip key={index}>{narration}</Chip>
      ))}
      {rest > 0 && (
        <li
          className="px-1.5 py-0.5 text-meta font-semibold text-ink-meta"
          title={narrations.slice(SHOWN_DESCRIPTIONS).join("\n")}
        >
          +{rest}
        </li>
      )}
    </ul>
  );
}

/**
 * The rule the selected drafts would make: the account they go to, their
 * descriptions and a note for next time. Adding it puts it with the new
 * rules; the drafts keep no category until the categorizer runs.
 */
function DraftRule({
  selected,
  uncategorised,
  inNewRules,
  onAdded,
}: {
  selected: readonly SelectedDraft[];
  /** The account's drafts that have no category. */
  uncategorised: number;
  /** How many of them are in new rules, and so off the list. */
  inNewRules: number;
  onAdded: () => void;
}) {
  const accountLookup = useTableLookup<number>("accounts");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [missingAccount, setMissingAccount] = useState(false);
  const add = useMutation({
    mutationFn: (chosen: number) =>
      categorizationLessonsApi.teachCategorization({
        body: {
          draft_ids: selected.map((draft) => draft.id),
          account_id: chosen,
          note: note.trim(),
        },
      }),
  });

  if (selected.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-sap-border-strong px-4 py-3 text-meta text-ink-soft">
        {uncategorised === 0
          ? "Every draft has a category"
          : uncategorised <= inNewRules
            ? "Every draft is in a new rule"
            : "Select drafts to make a rule"}
      </p>
    );
  }

  const submit = () => {
    if (accountId === null) {
      setMissingAccount(true);
      return;
    }
    add.mutate(accountId, {
      onSuccess: () => {
        onAdded();
        // The next rule starts empty.
        setAccountId(null);
        setNote("");
      },
    });
  };

  return (
    <section
      aria-label="Draft rule"
      className="space-y-3 rounded-card border border-dashed border-primary/60 bg-card px-4 py-3.5"
    >
      <div>
        <LookupPicker
          id="rule-account"
          lookup={accountLookup}
          value={accountId}
          onChange={(id) => {
            setAccountId(id);
            setMissingAccount(false);
          }}
          placeholder="Goes to…"
          disabled={add.isPending}
          ariaInvalid={missingAccount}
          ariaDescribedBy={missingAccount ? "rule-account-error" : undefined}
          className="w-full"
        />
        {missingAccount && (
          <p
            id="rule-account-error"
            className="mt-1 text-meta text-destructive"
          >
            Choose an account
          </p>
        )}
        <Descriptions narrations={selected.map((draft) => draft.narration)} />
      </div>
      <input
        type="text"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Note, e.g. a food delivery app"
        aria-label="Note for next time"
        className="block h-sap-ctl w-full rounded-control border border-sap-border bg-card px-3 text-meta text-foreground placeholder:text-ink-meta"
      />
      {add.isError && (
        <p className="text-meta text-destructive [overflow-wrap:anywhere]">
          {apiErrorMessage(add.error)}
        </p>
      )}
      <Button type="button" size="sm" disabled={add.isPending} onClick={submit}>
        Add rule for {plural(selected.length, "draft")}
      </Button>
    </section>
  );
}

/**
 * The new rules, as the rules page shows rules: the account, then its
 * descriptions. Under them, the one way on: hand them to the coding agent,
 * which adds them to the categorization rules and takes each off this list.
 */
function NewRules({
  lessons,
  onChanged,
  prompt,
  runCategorizerHref,
  onHandedOver,
}: {
  lessons: readonly CategorizationLesson[];
  onChanged: () => void;
  prompt: string;
  runCategorizerHref: string;
  /** The agent has them, or the user copied the prompt for it. */
  onHandedOver: () => void;
}) {
  const remove = useMutation({
    mutationFn: (id: number) =>
      categorizationLessonsApi.deleteCategorizationLesson({
        params: { id },
        body: {},
      }),
    onSettled: onChanged,
  });

  return (
    <>
      <ol className="rounded-card border border-sap-border bg-card shadow-card">
        {lessons.map((lesson, index) => (
          <li
            key={lesson.id}
            className={
              index === 0 ? "px-4 py-3" : "border-t border-line-inner px-4 py-3"
            }
          >
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-row font-semibold text-foreground">
                {lesson.account.name}
              </p>
              <button
                type="button"
                onClick={() => remove.mutate(lesson.id)}
                disabled={remove.isPending}
                title="Remove this rule. Its drafts go back on the list."
                aria-label={`Remove the rule for ${lesson.account.name}`}
                className="-mr-1 rounded-control p-1 text-ink-meta hover:bg-sap-row-hover hover:text-foreground disabled:opacity-50"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </div>
            <Descriptions narrations={lesson.narrations} />
            {lesson.note !== "" && (
              <p className="mt-1.5 text-meta text-ink-soft [overflow-wrap:anywhere]">
                {lesson.note}
              </p>
            )}
          </li>
        ))}
      </ol>
      {remove.isError && (
        <p className="text-meta text-destructive [overflow-wrap:anywhere]">
          {apiErrorMessage(remove.error)}
        </p>
      )}
      <div>
        <AgentActions
          standalone
          prompt={prompt}
          goal={`Add ${lessons.length} to categorization rules`}
          onActed={(how) => {
            if (how !== "command") onHandedOver();
          }}
          afterwards={
            <Link
              to={runCategorizerHref}
              className="font-semibold text-primary hover:underline"
            >
              Then run the categorizer
            </Link>
          }
        />
        <div className="mt-2">
          <Disclosure tone="assist" summary="Preview the prompt">
            <PromptText prompt={prompt} />
          </Disclosure>
        </div>
      </div>
    </>
  );
}
