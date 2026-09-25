import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, Loader2, Wand2 } from "lucide-react";
import { getApiBase } from "@sapporta/frontend/platform";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import {
  gpayDraftClassificationSchema,
  type CategorizationReport,
  type CategorizationTally,
  type DraftClassification,
} from "../../shared/index";
import { draftTransactionsApi, importPresetsApi } from "../api";
import { EmptyState } from "../components/empty-state";
import { FactTable, type Fact } from "../components/fact-table";
import { Button } from "../components/ui/button";
import { plural } from "../format";
import { CategorizationNote } from "../views/categorization/CategorizationFigures";
import { AgentUnavailableDialog } from "../views/categorization/AgentUnavailableDialog";
import {
  accountPreset,
  CategorizationInstructions,
  presetAccounts,
  type PresetAccount,
} from "../views/categorization/CategorizationInstructions";
import {
  agentUnavailable,
  categorizationCounts,
  describeCategorizationProblem,
} from "../views/categorization/describeCategorization";
import { ReportTab } from "./report-tab";
import { useReviewAccount } from "./ReviewAccount";
import {
  parseAccountId,
  REVIEW_ROUTE,
  reviewHref,
  RUN_CATEGORIZER_TAB,
} from "./routes";

interface Account {
  id: number;
  name: string;
}

interface DraftRow {
  id: number;
  date: string;
  narration: string;
  withdrawal: string;
  deposit: string;
  account_id: number | null;
}

// Both classify routes answer with the same transactions and report; only the
// Google Pay one is called through `fetch`, for the upload, so its answer is
// parsed against the contract here.
type ClassifyResult = DraftClassification["transactions"][number];

// What one run did, for the dialog that sums it up.
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
 * no category, with the instructions it imports with or another preset
 * account's, and optionally a Google Pay export. A dialog sums up the run,
 * and closing it goes back to the account's Overview.
 */
export function RunCategorizerTab() {
  const { detail, refresh } = useReviewAccount();
  const { account_id: accountId, name: accountName } = detail.account;
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  // Null until they load.
  const [presets, setPresets] = useState<PresetAccount[] | null>(null);
  // The preset account whose instructions the user chose, by its account_id,
  // null for none; until they choose, the account's own.
  const [presetChoice, setPresetChoice] = useState<number | null | undefined>(
    undefined,
  );
  const [gpayFile, setGpayFile] = useState<File | null>(null);
  const [run, setRun] = useState<CategorizerRun | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [classifying, setClassifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${getApiBase()}/tables/accounts?limit=1000&sort=name`)
      .then((r) => r.json())
      .then((body: { data: Account[] }) => setAccounts(body.data))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load accounts"),
      );
  }, []);

  useEffect(() => {
    importPresetsApi
      .listImportPresets({})
      .then((view) => setPresets(presetAccounts(view)))
      .catch(() => setPresets([]));
  }, []);

  const accountLookups = useMemo<Record<string, string>>(
    () => Object.fromEntries(accounts.map((a) => [String(a.id), a.name])),
    [accounts],
  );

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

  // What a run sends: the drafts still without an account. The table keeps
  // the ones a run categorized, to show what it chose.
  const uncategorized = rows.filter((row) => row.account_id === null);

  const chosenPresetId = presetChoice === undefined ? accountId : presetChoice;
  const chosenPreset =
    chosenPresetId === null
      ? null
      : accountPreset(presets ?? [], chosenPresetId);

  async function handleRun() {
    if (uncategorized.length === 0) return;
    setClassifying(true);
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
            ? {
                ...row,
                narration: transaction.narration,
                account_id: transaction.account_id,
              }
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

  // Why a run can't start yet; undefined once it can.
  const runWaiting = loadingRows
    ? "Loading its drafts"
    : presets === null
      ? "Loading the presets"
      : uncategorized.length === 0
        ? "Every draft has a category"
        : undefined;

  if (!loadingRows && rows.length === 0 && error === null) {
    return (
      <ReportTab>
        <EmptyState
          className="max-w-[760px]"
          title="Every draft has a category"
          body={`None of the drafts for ${accountName} need the categorizer.`}
        />
      </ReportTab>
    );
  }

  return (
    <ReportTab>
      <AgentUnavailableDialog problem={unavailable} />
      {run && !unavailable && (
        <CategorizerRunDialog
          run={run}
          onDone={() => navigate(reviewHref(accountId))}
        />
      )}
      <div className="max-w-6xl space-y-4">
        <div className="space-y-5 rounded-card border bg-card p-4">
          <p className="text-row text-ink-soft">
            {loadingRows
              ? "Loading drafts…"
              : uncategorized.length === 0
                ? "Every draft has a category."
                : `${plural(uncategorized.length, "draft")} without a category`}
          </p>

          {presets !== null && (
            <CategorizationInstructions
              presets={presets}
              accountId={accountId}
              accountName={accountName}
              chosen={chosenPreset}
              onChoose={setPresetChoice}
              disabled={classifying}
            />
          )}

          <div className="space-y-1">
            <label
              htmlFor="classify-gpay"
              className="text-meta font-medium text-ink-soft"
            >
              Google Pay activity{" "}
              <span className="font-normal text-ink-meta">
                (optional, My Activities.html)
              </span>
            </label>
            <input
              id="classify-gpay"
              type="file"
              accept=".html,.htm"
              disabled={classifying}
              onChange={(event) => {
                setGpayFile(event.target.files?.[0] ?? null);
                setError(null);
              }}
              className="block w-full text-meta text-ink-meta file:mr-3 file:cursor-pointer file:rounded-control file:border file:border-sap-border-strong file:bg-card file:px-3 file:py-1 file:text-meta file:font-semibold file:text-foreground hover:file:bg-muted"
            />
            <p className="text-meta text-ink-meta">
              Names the payees of matching withdrawals before your rules run.
            </p>
          </div>

          <Button
            onClick={handleRun}
            waiting={runWaiting}
            disabled={classifying}
          >
            {classifying ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {classifying
              ? "Categorizing…"
              : uncategorized.length === 0
                ? "Categorize"
                : `Categorize ${plural(uncategorized.length, "draft")}`}
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-card border border-destructive/30 bg-destructive/10 p-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
            <div className="text-row text-destructive break-words">{error}</div>
          </div>
        )}

        <div className="overflow-x-auto rounded-card border bg-card">
          <table className="w-full text-row">
            <thead className="bg-muted text-left text-ink-meta">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Narration</th>
                <th className="px-3 py-2 text-right font-medium">Withdrawal</th>
                <th className="px-3 py-2 text-right font-medium">Deposit</th>
                <th className="px-3 py-2 font-medium">Account</th>
              </tr>
            </thead>
            <tbody>
              {loadingRows ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="tnum whitespace-nowrap px-3 py-2 font-mono">
                      {row.date}
                    </td>
                    <td className="px-3 py-2">{row.narration}</td>
                    <td className="tnum whitespace-nowrap px-3 py-2 text-right font-mono">
                      {row.withdrawal}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-2 text-right font-mono">
                      {row.deposit}
                    </td>
                    <td className="px-3 py-2">
                      {row.account_id === null
                        ? "Uncategorized"
                        : (accountLookups[String(row.account_id)] ??
                          row.account_id)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </ReportTab>
  );
}

/**
 * What a run did, as figures: how many it categorized, how many are left,
 * and where they went. Closing it, by OK or otherwise, is done with the run.
 */
function CategorizerRunDialog({
  run,
  onDone,
}: {
  run: CategorizerRun;
  onDone: () => void;
}) {
  const counts = categorizationCounts(run.tally);
  const problem = describeCategorizationProblem(run.report);
  const sent = counts.categorized + counts.remaining;
  const figures: Fact[] = [
    { label: "Categorized", value: String(counts.categorized) },
    { label: "Left to categorize", value: String(counts.remaining) },
  ];
  if (run.gpayEnrichedCount !== null) {
    figures.push({
      label: "Named by Google Pay",
      value: String(run.gpayEnrichedCount),
    });
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {counts.remaining === 0
              ? "All drafts categorized"
              : `Categorized ${counts.categorized} of ${plural(sent, "draft")}`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <FactTable rows={figures} />
          <FactTable
            heading="By category"
            rows={run.tally.accounts.map((account) => ({
              label: account.account_name,
              value: String(account.count),
            }))}
          />
          {problem && (
            <CategorizationNote problem={problem}>
              Once that's fixed, run the categorizer again.
            </CategorizationNote>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onDone}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
