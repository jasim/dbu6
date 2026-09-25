import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { AlertCircle, CircleCheck, Loader2, Wand2 } from "lucide-react";
import { getApiBase } from "@sapporta/frontend/platform";
import { cn } from "@sapporta/ui/cn";
import {
  gpayDraftClassificationSchema,
  type CategorizationReport,
  type CategorizationTally,
  type DraftClassification,
} from "../../shared/index";
import { draftTransactionsApi, importPresetsApi } from "../api";
import { EmptyState } from "../components/empty-state";
import { FactTable, type Fact } from "../components/fact-table";
import { Button, buttonVariants } from "../components/ui/button";
import { plural } from "../format";
import { CategorizationNote } from "../views/categorization/CategorizationFigures";
import { AgentUnavailableDialog } from "../views/categorization/AgentUnavailableDialog";
import {
  accountPreset,
  InstructionsChoice,
  presetAccounts,
  presetNames,
  type PresetAccount,
} from "../views/categorization/CategorizationInstructions";
import {
  agentUnavailable,
  categorizationCounts,
  describeCategorizationProblem,
} from "../views/categorization/describeCategorization";
import { CATEGORIZATION_RULES_ROUTE } from "../views/import-instructions/routes";
import { ReportTab } from "./report-tab";
import { useReviewAccount } from "./ReviewAccount";
import {
  IMPROVE_CATEGORIZATION_TAB,
  needsCategoryHref,
  parseAccountId,
  REVIEW_ROUTE,
  reviewHref,
  RUN_CATEGORIZER_TAB,
  withReviewRun,
} from "./routes";

interface DraftRow {
  id: number;
  account_id: number | null;
}

// Both classify routes answer with the same transactions and report; only the
// Google Pay one is called through `fetch`, for the upload, so its answer is
// parsed against the contract here.
type ClassifyResult = DraftClassification["transactions"][number];

// What one run did, for the card that sums it up.
interface CategorizerRun {
  tally: CategorizationTally;
  report: CategorizationReport;
  gpayEnrichedCount: number | null;
}

/**
 * The page this tab replaced, `/views/reclassify-drafts?account=<id>`, now
 * opens the tab; without an account, the Review picker.
 */
export function ReclassifyDraftsRedirect() {
  const [searchParams] = useSearchParams();
  const accountId = parseAccountId(searchParams.get("account") ?? undefined);
  return (
    <Navigate
      to={
        accountId === null
          ? REVIEW_ROUTE
          : reviewHref(accountId, RUN_CATEGORIZER_TAB)
      }
      replace
    />
  );
}

/**
 * Run categorizer: the categoriser again over the account's drafts that have
 * no category. One card says how many and runs it, with the account's own
 * instructions unless the user changes them, and optionally a Google Pay
 * export. After the run the card sums it up and points at what is left.
 */
export function RunCategorizerTab() {
  const { detail, refresh, setup } = useReviewAccount();
  const { account_id: accountId, name: accountName } = detail.account;
  // Null until they load.
  const [presets, setPresets] = useState<PresetAccount[] | null>(null);
  // The preset account whose instructions the user chose, by its account_id,
  // null for none; until they choose, the account's own.
  const [presetChoice, setPresetChoice] = useState<number | null | undefined>(
    undefined,
  );
  const [changingPreset, setChangingPreset] = useState(false);
  const [gpayFile, setGpayFile] = useState<File | null>(null);
  const [run, setRun] = useState<CategorizerRun | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [classifying, setClassifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    importPresetsApi
      .listImportPresets({})
      .then((view) => setPresets(presetAccounts(view)))
      .catch(() => setPresets([]));
  }, []);

  useEffect(() => {
    setLoadingRows(true);
    setError(null);
    const params = new URLSearchParams({
      "filter[base_account_id][eq]": String(accountId),
      "filter[account_id][is]": "null",
      limit: "1000",
      sort: "date,id",
    });
    fetch(`${getApiBase()}/tables/draft_transactions?${params}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => null);
          const msg =
            body && typeof body === "object" && "error" in body
              ? String((body as { error: unknown }).error)
              : `HTTP ${r.status}`;
          throw new Error(msg);
        }
        const body = (await r.json()) as { data: DraftRow[] };
        setRows(body.data);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load drafts"),
      )
      .finally(() => setLoadingRows(false));
  }, [accountId]);

  // What a run sends: the drafts still without an account.
  const uncategorized = rows.filter((row) => row.account_id === null);

  const chosenPresetId = presetChoice === undefined ? accountId : presetChoice;
  const chosenPreset =
    chosenPresetId === null
      ? null
      : accountPreset(presets ?? [], chosenPresetId);

  async function handleRun() {
    if (uncategorized.length === 0) return;
    setClassifying(true);
    setChangingPreset(false);
    setError(null);
    setRun(null);
    const customMappings =
      chosenPreset?.account.custom_mappings_filenames ?? [];
    try {
      let updated: {
        transactions: ClassifyResult[];
        categorization: CategorizationReport;
        categorization_tally: CategorizationTally;
      };
      let gpayEnrichedCount: number | null = null;
      if (gpayFile) {
        const form = new FormData();
        uncategorized.forEach((row) => form.append("ids", String(row.id)));
        customMappings.forEach((filename) =>
          form.append("custom_mappings_filenames", filename),
        );
        form.append("gpay", gpayFile);

        const response = await fetch(
          `${getApiBase()}/draft-transactions/classify-with-gpay`,
          { method: "POST", body: form },
        );
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          const message =
            body && typeof body === "object" && "error" in body
              ? String((body as { error: unknown }).error)
              : `HTTP ${response.status}`;
          throw new Error(message);
        }
        const result = gpayDraftClassificationSchema.parse(
          await response.json(),
        );
        updated = result;
        gpayEnrichedCount = result.gpay_enriched_count;
      } else {
        updated = await draftTransactionsApi.classifyDraftTransactions({
          body: {
            ids: uncategorized.map((r) => r.id),
            custom_mappings_filenames: customMappings,
          },
        });
      }
      setRun({
        tally: updated.categorization_tally,
        report: updated.categorization,
        gpayEnrichedCount,
      });

      const byId = new Map(
        updated.transactions.map((transaction) => [
          transaction.id,
          transaction,
        ]),
      );
      setRows((prev) =>
        prev.map((row) => {
          const transaction = byId.get(row.id);
          return transaction
            ? { ...row, account_id: transaction.account_id }
            : row;
        }),
      );
      // The frame's counts and Home's follow the run.
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Classification failed");
    } finally {
      setClassifying(false);
    }
  }

  // The coding agent couldn't be used: its dialog, which sends the user to
  // Settings, says so instead of the run's summary.
  const unavailable = agentUnavailable([run?.report ?? null]);
  const inRun = (href: string) => withReviewRun(href, { setup });

  if (!loadingRows && rows.length === 0 && error === null) {
    return (
      <ReportTab>
        <EmptyState
          className="max-w-[640px]"
          title="Every draft has a category"
          body={`None of the drafts for ${accountName} need the categorizer.`}
        />
      </ReportTab>
    );
  }

  // Why a run can't start yet; undefined once it can.
  const runWaiting = loadingRows
    ? "Loading its drafts"
    : presets === null
      ? "Loading the instructions"
      : undefined;

  return (
    <ReportTab>
      <AgentUnavailableDialog problem={unavailable} />
      <div className="max-w-[640px] space-y-4">
        {run && !unavailable ? (
          <RunResult
            run={run}
            draftsHref={inRun(needsCategoryHref(accountId))}
            improveHref={inRun(
              reviewHref(accountId, IMPROVE_CATEGORIZATION_TAB),
            )}
            overviewHref={inRun(reviewHref(accountId))}
            onRunAgain={() => setRun(null)}
          />
        ) : (
          <section
            aria-labelledby="run-categorizer-heading"
            className="space-y-4 rounded-card border bg-card p-5"
          >
            <h2
              id="run-categorizer-heading"
              className="text-heading text-foreground"
            >
              {loadingRows
                ? "Loading drafts…"
                : `${plural(uncategorized.length, "draft")} ${uncategorized.length === 1 ? "needs" : "need"} a category`}
            </h2>

            <dl className="divide-y divide-line-inner border-y border-line-inner">
              <Setting
                label="Guidance"
                value={
                  changingPreset && presets !== null ? (
                    <InstructionsChoice
                      presets={presets}
                      chosen={chosenPreset}
                      onChoose={setPresetChoice}
                      onClose={() => setChangingPreset(false)}
                    />
                  ) : (
                    <InstructionsValue
                      presets={presets}
                      chosen={chosenPreset}
                    />
                  )
                }
                actions={
                  !changingPreset &&
                  presets !== null && (
                    <>
                      {chosenPreset !== null && (
                        <Link
                          to={`${CATEGORIZATION_RULES_ROUTE}?${new URLSearchParams({ account: String(chosenPreset.account.account_id) })}`}
                          className={buttonVariants({
                            variant: "ghost",
                            size: "sm",
                          })}
                        >
                          View
                        </Link>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={classifying}
                        onClick={() => setChangingPreset(true)}
                      >
                        Change
                      </Button>
                    </>
                  )
                }
              />
              <Setting
                label="Google Pay"
                value={
                  gpayFile === null ? (
                    <span className="text-ink-meta">
                      Not added
                      <span className="block text-meta">
                        Names payees, from My Activities.html
                      </span>
                    </span>
                  ) : (
                    <span className="[overflow-wrap:anywhere]">
                      {gpayFile.name}
                    </span>
                  )
                }
                actions={
                  gpayFile === null ? (
                    <label
                      className={cn(
                        buttonVariants({ variant: "ghost", size: "sm" }),
                        "cursor-pointer has-disabled:pointer-events-none has-disabled:opacity-50",
                      )}
                    >
                      Add file
                      <input
                        type="file"
                        accept=".html,.htm"
                        disabled={classifying}
                        className="sr-only"
                        onChange={(event) => {
                          setGpayFile(event.target.files?.[0] ?? null);
                          setError(null);
                        }}
                      />
                    </label>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={classifying}
                      onClick={() => setGpayFile(null)}
                    >
                      Remove
                    </Button>
                  )
                }
              />
            </dl>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button
                onClick={handleRun}
                waiting={runWaiting}
                disabled={classifying}
              >
                {classifying ? <Loader2 className="animate-spin" /> : <Wand2 />}
                {classifying
                  ? "Categorizing…"
                  : `Categorize ${plural(uncategorized.length, "draft")}`}
              </Button>
              {!loadingRows && (
                <Link
                  to={inRun(needsCategoryHref(accountId))}
                  className="text-meta text-ink-soft hover:text-foreground hover:underline"
                >
                  See them in Drafts
                </Link>
              )}
            </div>
          </section>
        )}

        {error && (
          <div className="flex items-start gap-3 rounded-card border border-destructive/30 bg-destructive/10 p-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
            <div className="text-row text-destructive break-words">{error}</div>
          </div>
        )}
      </div>
    </ReportTab>
  );
}

/** One row of the card: what it is, what it's set to, and how to change it. */
function Setting({
  label,
  value,
  actions,
}: {
  label: string;
  value: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-row">
      <dt className="w-28 shrink-0 text-ink-soft">{label}</dt>
      <dd className="min-w-0 flex-1 text-foreground">{value}</dd>
      {actions && <dd className="flex shrink-0 gap-2">{actions}</dd>}
    </div>
  );
}

/** Whose instructions a run uses, and how many files they are. */
function InstructionsValue({
  presets,
  chosen,
}: {
  presets: readonly PresetAccount[] | null;
  chosen: PresetAccount | null;
}) {
  if (presets === null) return <span className="text-ink-meta">Loading…</span>;
  if (chosen === null) return <span className="text-ink-meta">None</span>;
  const files = chosen.account.custom_mappings_filenames.length;
  return (
    <>
      {presetNames(presets).get(chosen.account.account_id)}
      <span className="text-ink-meta">
        {" · "}
        {files === 0 ? "no files" : plural(files, "file")}
      </span>
    </>
  );
}

/**
 * What a run did, in place of the card that started it: how many it
 * categorized and where they went, and then the way on. Drafts still without
 * a category go to Drafts, to categorize by hand, or to Improve
 * categorization, to teach the categoriser.
 */
function RunResult({
  run,
  draftsHref,
  improveHref,
  overviewHref,
  onRunAgain,
}: {
  run: CategorizerRun;
  draftsHref: string;
  improveHref: string;
  overviewHref: string;
  onRunAgain: () => void;
}) {
  const counts = categorizationCounts(run.tally);
  const problem = describeCategorizationProblem(run.report);
  const sent = counts.categorized + counts.remaining;
  const figures: Fact[] = run.tally.accounts.map((account) => ({
    label: account.account_name,
    value: String(account.count),
  }));
  if (run.gpayEnrichedCount !== null) {
    figures.push({
      label: "Named by Google Pay",
      value: String(run.gpayEnrichedCount),
    });
  }
  if (counts.remaining > 0) {
    figures.push({
      label: "Still need a category",
      value: String(counts.remaining),
    });
  }
  return (
    <section
      aria-labelledby="categorizer-run-heading"
      className="space-y-4 rounded-card border bg-card p-5"
    >
      <h2
        id="categorizer-run-heading"
        className="flex items-center gap-2 text-heading text-foreground"
      >
        {counts.categorized > 0 && (
          <CircleCheck aria-hidden="true" className="size-5 text-primary" />
        )}
        {counts.remaining === 0
          ? `All ${plural(sent, "draft")} categorized`
          : `${counts.categorized} of ${plural(sent, "draft")} categorized`}
      </h2>
      <FactTable rows={figures} />
      {problem && (
        <CategorizationNote problem={problem}>
          Once that's fixed,{" "}
          <button
            type="button"
            onClick={onRunAgain}
            className="font-semibold underline underline-offset-4"
          >
            run the categorizer again
          </button>
          .
        </CategorizationNote>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {counts.remaining > 0 ? (
          <>
            <Link to={draftsHref} className={buttonVariants()}>
              Categorize the {counts.remaining} by hand
            </Link>
            <Link
              to={improveHref}
              className={buttonVariants({ variant: "outline" })}
            >
              Teach the categorizer
            </Link>
            <Link
              to={overviewHref}
              className={buttonVariants({ variant: "ghost" })}
            >
              Done
            </Link>
          </>
        ) : (
          <Link to={overviewHref} className={buttonVariants()}>
            Done
          </Link>
        )}
      </div>
    </section>
  );
}
