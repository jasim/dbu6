import { useState } from "react";
import { Loader2, Upload, CheckCircle2, AlertCircle } from "lucide-react";
import { ApiError, fetchApi } from "@sapporta/frontend/platform";
import { AppPage } from "@sapporta/frontend/shell";

interface ImportResult {
  hledger_journal: string;
  transaction_count: number;
  draft_transaction_count: number;
  duplicate_count: number;
}

interface ImportFailure {
  status: number | null;
  code: string | null;
  message: string;
  checkpointDate: string | null;
  checkpointBalance: number | null;
}

export function ImportHdfcBankStatement() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<ImportFailure | null>(null);

  async function handleSubmit() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append("file", file);

    try {
      const response = await fetchApi("/import-draft/hdfc-bank/upload", {
        method: "POST",
        body: form,
      });
      setResult((await response.json()) as ImportResult);
    } catch (err) {
      setError(importFailureFrom(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppPage section="Import" title="Import HDFC Bank Statement">
      <div className="p-8 max-w-2xl space-y-6">
        <p className="text-sm text-muted-foreground">
          Upload an HDFC bank statement XLS file. Transactions will be parsed,
          categorized, and written to the draft transactions table.
        </p>

        <div className="space-y-3 rounded-md border p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Upload className="h-4 w-4" />
            XLS file
          </label>
          <input
            type="file"
            accept=".xls,.xlsx"
            disabled={loading}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
            className="block w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer"
          />
          {file && (
            <p className="text-xs text-muted-foreground">
              Selected: <span className="font-mono">{file.name}</span> (
              {Math.round(file.size / 1024)} KB)
            </p>
          )}
          <button
            onClick={handleSubmit}
            disabled={!file || loading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "Importing..." : "Import"}
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4"
          >
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
            <div className="min-w-0 space-y-3">
              <div>
                <div className="text-sm font-medium text-destructive">
                  {error.code === "reconciliation_match_failed"
                    ? "Reconciliation check failed"
                    : "Import failed"}
                </div>
                <div className="mt-1 break-words text-sm text-destructive/80">
                  {error.message}
                </div>
              </div>

              {error.code === "reconciliation_match_failed" &&
                (error.checkpointDate !== null ||
                  error.checkpointBalance !== null) && (
                  <div className="rounded-md border border-destructive/30 bg-background/60 p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Reconciliation checkpoint
                    </div>
                    <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                      {error.checkpointDate !== null && (
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Assertion date
                          </dt>
                          <dd className="font-medium tabular-nums">
                            {error.checkpointDate}
                          </dd>
                        </div>
                      )}
                      {error.checkpointBalance !== null && (
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Asserted balance
                          </dt>
                          <dd className="font-medium tabular-nums">
                            {formatInr(error.checkpointBalance)}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>
                )}

              {(error.status !== null || error.code !== null) && (
                <div className="break-words font-mono text-xs text-muted-foreground">
                  {error.status !== null ? `HTTP ${error.status}` : null}
                  {error.status !== null && error.code !== null ? " · " : null}
                  {error.code}
                </div>
              )}
            </div>
          </div>
        )}

        {result && (
          <div className="rounded-md border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <div className="text-sm font-medium">Import complete</div>
            </div>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Transactions parsed</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {result.transaction_count}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  Draft transactions created
                </dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {result.draft_transaction_count}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Duplicates skipped</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {result.duplicate_count}
                </dd>
              </div>
            </dl>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Show hledger journal
              </summary>
              <pre className="mt-2 p-3 bg-nested rounded overflow-x-auto whitespace-pre font-mono">
                {result.hledger_journal}
              </pre>
            </details>
          </div>
        )}
      </div>
    </AppPage>
  );
}

function importFailureFrom(error: unknown): ImportFailure {
  if (error instanceof ApiError) {
    const body = isRecord(error.body) ? error.body : null;
    const code = stringValue(body?.error);
    return {
      status: error.status,
      code,
      message:
        stringValue(body?.message) ??
        code ??
        `Upload failed (HTTP ${error.status})`,
      checkpointDate: stringValue(body?.checkpoint_date),
      checkpointBalance: numberValue(body?.checkpoint_balance),
    };
  }

  return {
    status: null,
    code: null,
    message: error instanceof Error ? error.message : "Upload failed",
    checkpointDate: null,
    checkpointBalance: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatInr(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(value);
}
