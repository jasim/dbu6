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
import { Field } from "../components/focus-card";
import { Button } from "../components/ui/button";
import {
  formatAmountRange,
  formatMoney,
  formatShortDate,
  plural,
} from "../format";
import { categorizationLessonsQuery } from "../queries";
import { Chip } from "../views/import-instructions/rule-parts";
import { categorizationRulesHref } from "../views/import-instructions/routes";
import type { CategorizationLesson } from "../../shared/index";
import { amountsSeen, lessonsPrompt } from "./categorization-lessons";
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
// Selected transactions listed before the rest open on demand.
const SHOWN_SELECTED = 8;

/** A draft the user selected in the grid. */
interface SelectedDraft {
  id: number;
  date: string;
  narration: string;
  /** Money in is positive, money out negative. */
  amount: number;
}

/**
 * Improve categorization: new rules on the left, the account's drafts with
 * no account on the right, by narration. The user selects drafts that go
 * together, which makes a draft rule, with the selected transactions under
 * it; choosing its account adds it to the new rules, kept in the books as
 * lessons, and takes its drafts off the list.
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
  // A draft in a new rule leaves the list. Lessons keep copies of their
  // drafts, not the drafts, so the list leaves out every draft with one of
  // their narrations. A new object recreates the grid's session, so it is
  // kept per account and new rules.
  const queued = useMemo(
    () => [
      ...new Set(
        lessons.data?.flatMap((lesson) =>
          lesson.transactions.map((transaction) => transaction.narration),
        ),
      ),
    ],
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

  // The grid owns the selection; the draft rule follows it. Its row count
  // heads it.
  const [selected, setSelected] = useState<SelectedDraft[]>([]);
  const [listed, setListed] = useState<number | null>(null);
  const session = useRef<TGridSession<SchemaTableRowsByLevel> | null>(null);
  const unsubscribe = useRef<(() => void)[]>([]);
  const sessionRef = useCallback(
    (current: TGridSession<SchemaTableRowsByLevel> | null) => {
      for (const each of unsubscribe.current) each();
      unsubscribe.current = [];
      session.current = current;
      if (current === null) {
        setSelected([]);
        setListed(null);
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
        current.queryStore.subscribe((state) =>
          setListed(state.totalCount ?? null),
        ),
      ];
      read();
      setListed(current.queryStore.getState().totalCount ?? null);
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
              (sum, lesson) => sum + lesson.transactions.length,
              0,
            ) ?? 0
          }
          onAdded={refreshLessons}
        />
        {selected.length > 0 && <SelectedDrafts selected={selected} />}
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
      <section
        aria-labelledby="uncategorised-heading"
        className="flex h-[60vh] min-h-0 min-w-0 flex-1 flex-col [--sap-page-header-inset:0px] [--sap-selection:var(--sap-brand-soft)] md:h-auto"
      >
        <h2
          id="uncategorised-heading"
          className="px-3 pt-4 text-subheading text-foreground sm:px-4"
        >
          Couldn't categorize
          {listed !== null && (
            <span className="tnum ml-2 text-meta font-medium text-ink-meta">
              {listed}
            </span>
          )}
        </h2>
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
      </section>
    </div>
  );
}

/** A loaded grid row as the draft the panel shows, or none. */
function selectedDraft(row: unknown): SelectedDraft[] {
  if (typeof row !== "object" || row === null) return [];
  const { id, date, narration, withdrawal, deposit } = row as Record<
    string,
    unknown
  >;
  if (typeof id !== "number" || typeof narration !== "string") return [];
  return [
    {
      id,
      date: typeof date === "string" ? date : "",
      narration,
      amount: (Number(deposit) || 0) - (Number(withdrawal) || 0),
    },
  ];
}

/**
 * The transactions selected in the grid, as the statement shows them: date,
 * description, amount. The first few, and the rest on demand.
 */
function SelectedDrafts({ selected }: { selected: readonly SelectedDraft[] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? selected : selected.slice(0, SHOWN_SELECTED);
  const rest = selected.length - shown.length;
  return (
    <section aria-labelledby="selected-heading" className="space-y-2">
      <h3
        id="selected-heading"
        className="text-row font-semibold text-foreground"
      >
        Selected
        <span className="tnum ml-2 text-meta font-medium text-ink-meta">
          {selected.length}
        </span>
      </h3>
      <ul className="rounded-card border border-sap-border bg-card text-meta">
        {shown.map((draft, index) => (
          <li
            key={draft.id}
            className={
              "flex items-baseline gap-3 px-3 py-1.5" +
              (index === 0 ? "" : " border-t border-line-inner")
            }
          >
            <span className="tnum w-12 shrink-0 text-ink-meta">
              {formatShortDate(draft.date)}
            </span>
            <span
              className="min-w-0 flex-1 text-foreground [overflow-wrap:anywhere] line-clamp-2"
              title={draft.narration}
            >
              {draft.narration}
            </span>
            <span className="tnum shrink-0 font-mono text-foreground">
              {draft.amount > 0 ? "+" : ""}
              {formatMoney(Math.abs(draft.amount))}
            </span>
          </li>
        ))}
        {rest > 0 && (
          <li className="border-t border-line-inner">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full px-3 py-1.5 text-left font-semibold text-ink-meta hover:bg-sap-row-hover hover:text-foreground"
            >
              Show {rest} more
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

/**
 * The amounts a new rule's drafts moved, which the agent turns into a range
 * for the rule: "money out · 60 – 480".
 */
function amountsLine(lesson: CategorizationLesson): string {
  return amountsSeen(lesson.transactions)
    .map(
      (seen) =>
        `money ${seen.direction === "withdrawal" ? "out" : "in"} · ${formatAmountRange(seen)}`,
    )
    .join(", ");
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
 * The rule the selected drafts would make: the account they go to and a note
 * for next time; the drafts themselves are listed under it. Adding it puts it
 * with the new rules; the drafts keep no account until the categorizer runs.
 */
function DraftRule({
  selected,
  uncategorised,
  inNewRules,
  onAdded,
}: {
  selected: readonly SelectedDraft[];
  /** The account's drafts that have no account. */
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
    const done =
      uncategorised === 0
        ? "Every draft goes to an account"
        : uncategorised <= inNewRules
          ? "Every draft is in a new rule"
          : null;
    return done !== null ? (
      <p className="rounded-card border border-dashed border-sap-border-strong px-4 py-3 text-meta text-ink-soft">
        {done}
      </p>
    ) : (
      // A newcomer's first sight of the page: what to do, and what it buys.
      <div className="rounded-card border border-dashed border-sap-border-strong px-4 py-3">
        <p className="text-row font-semibold text-foreground">
          Select transactions that go together
        </p>
        <p className="mt-1 text-meta text-ink-soft">
          Choose the account they go to, and future ones like them will go there
          too.
        </p>
      </div>
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
      <Field id="rule-account" label="Account">
        <LookupPicker
          id="rule-account"
          lookup={accountLookup}
          value={accountId}
          onChange={(id) => {
            setAccountId(id);
            setMissingAccount(false);
          }}
          placeholder="Choose an account"
          disabled={add.isPending}
          ariaInvalid={missingAccount}
          ariaDescribedBy={missingAccount ? "rule-account-error" : undefined}
          className="w-full"
        />
        {missingAccount && (
          <p id="rule-account-error" className="text-meta text-destructive">
            Choose an account
          </p>
        )}
      </Field>
      <Field
        id="rule-note"
        label="Note"
        aside="optional · helps spot similar ones"
      >
        <textarea
          id="rule-note"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What these are, e.g. gym membership, paid monthly"
          className="block w-full resize-none rounded-control border border-sap-border bg-card px-3 py-1.5 text-meta text-foreground placeholder:text-ink-meta"
        />
      </Field>
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
              <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5 text-row font-semibold text-foreground">
                {lesson.account.name}
                <span className="tnum text-meta font-normal text-ink-soft">
                  {amountsLine(lesson)}
                </span>
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
            <Descriptions
              narrations={lesson.transactions.map(
                (transaction) => transaction.narration,
              )}
            />
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
