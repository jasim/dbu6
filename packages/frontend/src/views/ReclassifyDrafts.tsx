import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Upload,
  Wand2,
} from "lucide-react";
import { getApiBase } from "@sapporta/frontend/platform";
import { AppPage } from "@sapporta/frontend/shell";
import {
  gpayDraftClassificationSchema,
  type CategorizationReport,
  type DraftClassification,
} from "dbu6-shared";
import { draftTransactionsApi } from "../api";
import { Button } from "../components/ui/button";
import { AccountImportInputs } from "./AccountImportInputs";
import { describeCategorizationProblem } from "./categorization/describeCategorization";

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

export function ReclassifyDrafts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [baseAccountId, setBaseAccountId] = useState<string | null>(null);
  const [mappingsInput, setMappingsInput] = useState("");
  const [gpayFile, setGpayFile] = useState<File | null>(null);
  const [gpayEnrichedCount, setGpayEnrichedCount] = useState<number | null>(
    null,
  );
  const [categorization, setCategorization] =
    useState<CategorizationReport | null>(null);
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

  async function handleReclassify() {
    if (rows.length === 0) return;
    setClassifying(true);
    setError(null);
    setGpayEnrichedCount(null);
    setCategorization(null);
    const customMappings = mappingsInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      let updated: { transactions: ClassifyResult[] };
      if (gpayFile) {
        const form = new FormData();
        rows.forEach((row) => form.append("ids", String(row.id)));
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
        setCategorization(result.categorization);
      } else {
        const result = await draftTransactionsApi.classifyDraftTransactions({
          body: {
            ids: rows.map((r) => r.id),
            custom_mappings_filenames: customMappings,
          },
        });
        updated = result;
        setCategorization(result.categorization);
      }

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

  const categorizationProblem =
    categorization && describeCategorizationProblem(categorization);

  // Why classifying can't start yet; undefined once it can.
  const classifyWaiting =
    baseAccountId === null
      ? "Choose an account first"
      : loadingRows
        ? "Loading its drafts"
        : rows.length === 0
          ? "Every draft already has an account"
          : undefined;

  return (
    <AppPage section="Review drafts" title="Classify draft entries">
      <div className="p-8 max-w-6xl space-y-6">
        <p className="text-body text-ink-soft">
          Choose the bank or card account you imported. dbu6 will try the
          configured categorization rules again for entries that do not have an
          account yet. Anything it cannot classify stays in Draft entries for
          you to edit.
        </p>

        <div className="space-y-3 rounded-card border bg-card p-4">
          <AccountImportInputs
            accounts={accounts}
            baseAccountId={baseAccountId}
            onBaseAccountIdChange={setBaseAccountId}
            mappingsInput={mappingsInput}
            onMappingsInputChange={setMappingsInput}
            disabled={classifying}
          />

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-row font-medium text-foreground">
              <Upload className="h-4 w-4" />
              Google Pay My Activities.html (optional)
            </label>
            <p className="text-meta text-ink-meta">
              Matching withdrawal narrations are enriched before the
              categorization rules run.
            </p>
            <input
              type="file"
              accept=".html,.htm"
              disabled={classifying}
              onChange={(event) => {
                setGpayFile(event.target.files?.[0] ?? null);
                setGpayEnrichedCount(null);
                setError(null);
              }}
              className="block w-full text-row file:mr-3 file:py-1.5 file:px-3 file:rounded-control file:border file:border-sap-border-strong file:bg-card file:text-row file:font-semibold file:text-foreground hover:file:bg-muted file:cursor-pointer"
            />
            {gpayFile && <FileSummary file={gpayFile} />}
          </div>

          <Button
            onClick={handleReclassify}
            waiting={classifyWaiting}
            disabled={classifying}
          >
            {classifying ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {classifying
              ? "Classifying…"
              : `Classify ${rows.length || ""} row${rows.length === 1 ? "" : "s"}`.trim()}
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-card border border-destructive/30 bg-destructive/10 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
            <div className="text-row text-destructive break-words">{error}</div>
          </div>
        )}

        {categorizationProblem && (
          <div className="flex items-start gap-3 rounded-card border border-attention-border bg-attention-bg p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-attention-ink mt-0.5" />
            <div className="space-y-1 text-row text-attention-ink [overflow-wrap:anywhere]">
              <p>
                {categorizationProblem.text}. Those drafts stay uncategorized;
                classify them again once this is fixed.
              </p>
              <p className="text-meta">{categorizationProblem.reason}</p>
            </div>
          </div>
        )}

        {gpayEnrichedCount !== null && (
          <div className="flex items-start gap-3 rounded-card border border-money-in-border bg-money-in-bg p-4">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-money-in mt-0.5" />
            <div className="text-row text-money-in-ink">
              Enriched {gpayEnrichedCount} draft narration
              {gpayEnrichedCount === 1 ? "" : "s"} from Google Pay before
              classification.
            </div>
          </div>
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

function FileSummary({ file }: { file: File }) {
  return (
    <p className="text-meta text-ink-meta">
      Selected: <span className="font-mono">{file.name}</span> (
      <span className="tnum font-mono">{Math.round(file.size / 1024)}</span> KB)
    </p>
  );
}
