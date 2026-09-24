import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, Loader2, Wand2 } from "lucide-react";
import { LookupPicker, useTableLookup } from "@sapporta/frontend/lookup";
import { getApiBase } from "@sapporta/frontend/platform";
import { AppPage } from "@sapporta/frontend/shell";
import {
  gpayDraftClassificationSchema,
  type CategorizationReport,
  type CategorizationTally,
  type DraftClassification,
} from "../../shared/index";
import { draftTransactionsApi, importPresetsApi } from "../api";
import { FactTable } from "../components/fact-table";
import { Button } from "../components/ui/button";
import { plural } from "../format";
import { parseAccountId } from "../review/routes";
import {
  CategorizationFigures,
  CategorizationNote,
  Figures,
} from "./categorization/CategorizationFigures";
import { AgentUnavailableDialog } from "./categorization/AgentUnavailableDialog";
import {
  accountPreset,
  CategorizationInstructions,
  presetAccounts,
  type PresetAccount,
} from "./categorization/CategorizationInstructions";
import {
  agentUnavailable,
  categorizationCounts,
  describeCategorizationProblem,
} from "./categorization/describeCategorization";

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

const RECLASSIFY_DRAFTS_ROUTE = "/views/reclassify-drafts";
// The account whose drafts are classified, kept in the URL.
const ACCOUNT_PARAM = "account";

/** Classify drafts, opened on one account's uncategorized drafts. */
export function reclassifyDraftsHref(accountId: number): string {
  const query = new URLSearchParams([[ACCOUNT_PARAM, String(accountId)]]);
  return `${RECLASSIFY_DRAFTS_ROUTE}?${query}`;
}

// A run's tally, for the account it ran on.
interface Classified {
  accountId: number;
  tally: CategorizationTally;
  report: CategorizationReport;
}

export function ReclassifyDrafts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const accountId = parseAccountId(
    searchParams.get(ACCOUNT_PARAM) ?? undefined,
  );
  const baseAccountId = accountId === null ? null : String(accountId);
  const setBaseAccountId = (id: string | null) =>
    setSearchParams(id === null ? {} : { [ACCOUNT_PARAM]: id }, {
      replace: true,
    });
  const accountLookup = useTableLookup("accounts");
  // Null until they load.
  const [presets, setPresets] = useState<PresetAccount[] | null>(null);
  // The preset account whose instructions the user chose for an account's
  // run, by its account_id, null for none; until they choose, the account's
  // own.
  const [presetChoice, setPresetChoice] = useState<{
    accountId: number;
    presetAccountId: number | null;
  } | null>(null);
  const [gpayFile, setGpayFile] = useState<File | null>(null);
  const [gpayEnrichedCount, setGpayEnrichedCount] = useState<number | null>(
    null,
  );
  const [classified, setClassified] = useState<Classified | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
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
    if (baseAccountId === null) {
      setRows([]);
      return;
    }
    setLoadingRows(true);
    setError(null);
    const params = new URLSearchParams({
      "filter[base_account_id][eq]": String(baseAccountId),
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
  }, [baseAccountId]);

  // What a run sends: the drafts still without an account. The table keeps
  // the ones a run categorized, to show what it chose.
  const uncategorized = rows.filter((row) => row.account_id === null);

  const accountName =
    accountId === null ? undefined : accountLookups[String(accountId)];
  const chosenPresetId =
    presetChoice !== null && presetChoice.accountId === accountId
      ? presetChoice.presetAccountId
      : accountId;
  const chosenPreset =
    chosenPresetId === null
      ? null
      : accountPreset(presets ?? [], chosenPresetId);

  async function handleReclassify() {
    if (uncategorized.length === 0 || accountId === null) return;
    setClassifying(true);
    setError(null);
    setGpayEnrichedCount(null);
    setClassified(null);
    const customMappings =
      chosenPreset?.account.custom_mappings_filenames ?? [];
    try {
      let updated: {
        transactions: ClassifyResult[];
        categorization: CategorizationReport;
        categorization_tally: CategorizationTally;
      };
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
        setGpayEnrichedCount(result.gpay_enriched_count);
      } else {
        const result = await draftTransactionsApi.classifyDraftTransactions({
          body: {
            ids: uncategorized.map((r) => r.id),
            custom_mappings_filenames: customMappings,
          },
        });
        updated = result;
      }
      setClassified({
        accountId,
        tally: updated.categorization_tally,
        report: updated.categorization,
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Classification failed");
    } finally {
      setClassifying(false);
    }
  }

  // The last run, while its account is still the one chosen.
  const shownRun = classified?.accountId === accountId ? classified : null;
  const categorizationProblem =
    shownRun && describeCategorizationProblem(shownRun.report);

  // Why classifying can't start yet; undefined once it can.
  const classifyWaiting =
    baseAccountId === null
      ? "Choose an account first"
      : loadingRows
        ? "Loading its drafts"
        : presets === null
          ? "Loading the presets"
          : uncategorized.length === 0
            ? "Every draft already has an account"
            : undefined;

  return (
    <AppPage section="Review drafts" title="Classify draft entries">
      <AgentUnavailableDialog
        problem={agentUnavailable([shownRun?.report ?? null])}
      />
      <div className="p-5 max-w-6xl space-y-4">
        <div className="space-y-5 rounded-card border bg-card p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label
              htmlFor="classify-account"
              className="text-row font-semibold text-foreground"
            >
              Drafts from
            </label>
            <LookupPicker
              id="classify-account"
              lookup={accountLookup}
              value={accountId}
              onChange={(id) =>
                setBaseAccountId(id === null ? null : String(id))
              }
              placeholder="Choose a bank or card account…"
              disabled={classifying}
              className="w-72"
            />
            {accountId !== null && !loadingRows && (
              <span className="text-row text-ink-soft">
                {uncategorized.length === 0
                  ? "Every draft has a category."
                  : `${plural(uncategorized.length, "draft")} without a category`}
              </span>
            )}
          </div>

          {accountId !== null && presets !== null && (
            <CategorizationInstructions
              presets={presets}
              accountId={accountId}
              accountName={accountName}
              chosen={chosenPreset}
              onChoose={(presetAccountId) =>
                setPresetChoice({ accountId, presetAccountId })
              }
              disabled={classifying}
            />
          )}

          {accountId !== null && (
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
                  setGpayEnrichedCount(null);
                  setError(null);
                }}
                className="block w-full text-meta text-ink-meta file:mr-3 file:cursor-pointer file:rounded-control file:border file:border-sap-border-strong file:bg-card file:px-3 file:py-1 file:text-meta file:font-semibold file:text-foreground hover:file:bg-muted"
              />
              <p className="text-meta text-ink-meta">
                Names the payees of matching withdrawals before your rules run.
              </p>
            </div>
          )}

          <Button
            onClick={handleReclassify}
            waiting={classifyWaiting}
            disabled={classifying}
          >
            {classifying ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {classifying
              ? "Classifying…"
              : uncategorized.length === 0
                ? "Classify"
                : `Classify ${plural(uncategorized.length, "draft")}`}
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-card border border-destructive/30 bg-destructive/10 p-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
            <div className="text-row text-destructive break-words">{error}</div>
          </div>
        )}

        {shownRun && (
          <section
            aria-label="What the run did"
            className="space-y-3 rounded-card border bg-card p-3"
          >
            <Figures>
              <CategorizationFigures
                counts={categorizationCounts(shownRun.tally)}
                accountId={shownRun.accountId}
              />
            </Figures>
            {categorizationProblem && (
              <CategorizationNote problem={categorizationProblem}>
                Once that's fixed, classify them again.
              </CategorizationNote>
            )}
            <FactTable
              heading="By category"
              rows={shownRun.tally.accounts.map((account) => ({
                label: account.account_name,
                value: String(account.count),
              }))}
            />
            {gpayEnrichedCount !== null && (
              <p className="text-meta text-ink-meta">
                {gpayEnrichedCount === 0
                  ? "Google Pay named none of these payments."
                  : `Named ${plural(gpayEnrichedCount, "payment")} from Google Pay first.`}
              </p>
            )}
          </section>
        )}

        {baseAccountId !== null && (
          <div className="overflow-x-auto rounded-card border bg-card">
            <table className="w-full text-row">
              <thead className="bg-muted text-left text-ink-meta">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Narration</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Withdrawal
                  </th>
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
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-center text-muted-foreground"
                    >
                      No uncategorized drafts.
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
        )}
      </div>
    </AppPage>
  );
}
