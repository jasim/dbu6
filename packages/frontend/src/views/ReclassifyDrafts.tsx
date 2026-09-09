import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Upload,
  Wand2,
} from "lucide-react";
import { getApiBase } from "@sapporta/frontend/platform";
import { AppPage } from "@sapporta/frontend/shell";
import { draftTransactionsApi } from "../api";
import { AccountImportInputs } from "./AccountImportInputs";

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

interface ClassifyResult {
  id: number;
  narration: string;
  account_id: number | null;
  account_name: string | null;
}

interface GPayClassifyResult {
  transactions: ClassifyResult[];
  gpay_enriched_count: number;
}

export function ReclassifyDrafts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [baseAccountId, setBaseAccountId] = useState<string | null>(null);
  const [mappingsInput, setMappingsInput] = useState("");
  const [gpayFile, setGpayFile] = useState<File | null>(null);
  const [gpayEnrichedCount, setGpayEnrichedCount] = useState<number | null>(
    null,
  );
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
    const customMappings = mappingsInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      let updated: ClassifyResult[];
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
        const result = (await response.json()) as GPayClassifyResult;
        updated = result.transactions;
        setGpayEnrichedCount(result.gpay_enriched_count);
      } else {
        updated = await draftTransactionsApi.classifyDraftTransactions({
          body: {
            ids: rows.map((r) => r.id),
            custom_mappings_filenames: customMappings,
          },
        });
      }

      const byId = new Map(
        updated.map((transaction) => [transaction.id, transaction]),
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

  const canReclassify =
    baseAccountId !== null && rows.length > 0 && !classifying && !loadingRows;

  return (
    <AppPage section="Review drafts" title="Classify draft entries">
      <div className="p-8 max-w-6xl space-y-6">
        <p className="text-sm text-muted-foreground">
          Choose the bank or card account you imported. dbu6 will try the
          configured categorization rules again for entries that do not have an
          account yet. Anything it cannot classify stays in Draft entries for
          you to edit.
        </p>

        <div className="space-y-3 rounded-md border p-4">
          <AccountImportInputs
            accounts={accounts}
            baseAccountId={baseAccountId}
            onBaseAccountIdChange={setBaseAccountId}
            mappingsInput={mappingsInput}
            onMappingsInputChange={setMappingsInput}
            disabled={classifying}
          />

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Upload className="h-4 w-4" />
              Google Pay My Activities.html (optional)
            </label>
            <p className="text-xs text-muted-foreground">
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
              className="block w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer"
            />
            {gpayFile && <FileSummary file={gpayFile} />}
          </div>

          <button
            onClick={handleReclassify}
            disabled={!canReclassify}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {classifying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            {classifying
              ? "Classifying…"
              : `Classify ${rows.length || ""} row${rows.length === 1 ? "" : "s"}`.trim()}
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
            <div className="text-sm text-destructive/80 break-words">
              {error}
            </div>
          </div>
        )}

        {gpayEnrichedCount !== null && (
          <div className="flex items-start gap-3 rounded-md border border-green-500/50 bg-green-500/10 p-4">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 mt-0.5" />
            <div className="text-sm">
              Enriched {gpayEnrichedCount} draft narration
              {gpayEnrichedCount === 1 ? "" : "s"} from Google Pay before
              classification.
            </div>
          </div>
        )}

        {baseAccountId !== null && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-nested text-left text-muted-foreground">
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
                      <td className="whitespace-nowrap px-3 py-2">
                        {row.date}
                      </td>
                      <td className="px-3 py-2">{row.narration}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {row.withdrawal}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
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
    <p className="text-xs text-muted-foreground">
      Selected: <span className="font-mono">{file.name}</span> (
      {Math.round(file.size / 1024)} KB)
    </p>
  );
}
