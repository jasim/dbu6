import { useState } from "react";
import { Loader2, Upload, CheckCircle2, AlertCircle } from "lucide-react";
import { getApiBase } from "@sapporta/frontend/platform";
import { AppPage } from "@sapporta/frontend/shell";

interface ImportResult {
  hledger_journal: string;
  transaction_count: number;
  draft_transaction_count: number;
  duplicate_count: number;
  gpay_enriched_count: number;
}

export function ImportFederalBankStatement() {
  const [file, setFile] = useState<File | null>(null);
  const [gpayFile, setGpayFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append("file", file);
    if (gpayFile) form.append("gpay", gpayFile);

    try {
      const res = await fetch(
        `${getApiBase()}/import-draft/federal-bank/upload`,
        { method: "POST", body: form },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg =
          body && typeof body === "object" && "error" in body
            ? String((body as { error: unknown }).error)
            : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setResult((await res.json()) as ImportResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppPage section="Import" title="Import Federal Bank Statement">
      <div className="p-8 max-w-2xl space-y-6">
        <p className="text-sm text-muted-foreground">
          Upload a Federal Bank XLS/XLSX statement and optionally enrich UPI
          narrations from Google Pay Takeout HTML.
        </p>

        <div className="space-y-4 rounded-md border p-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Upload className="h-4 w-4" />
              Statement file
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
            {file && <FileSummary file={file} />}
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Upload className="h-4 w-4" />
              Google Pay HTML
            </label>
            <input
              type="file"
              accept=".html,.htm"
              disabled={loading}
              onChange={(e) => {
                setGpayFile(e.target.files?.[0] ?? null);
                setResult(null);
                setError(null);
              }}
              className="block w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer"
            />
            {gpayFile && <FileSummary file={gpayFile} />}
          </div>

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
          <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
            <div>
              <div className="text-sm font-medium text-destructive">
                Import failed
              </div>
              <div className="text-sm text-destructive/80 mt-1">{error}</div>
            </div>
          </div>
        )}

        {result && (
          <div className="rounded-md border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <div className="text-sm font-medium">Import complete</div>
            </div>
            <dl className="grid grid-cols-4 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Parsed</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {result.transaction_count}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Drafts created</dt>
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
              <div>
                <dt className="text-muted-foreground">GPay enriched</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {result.gpay_enriched_count}
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

function FileSummary({ file }: { file: File }) {
  return (
    <p className="text-xs text-muted-foreground">
      Selected: <span className="font-mono">{file.name}</span> (
      {Math.round(file.size / 1024)} KB)
    </p>
  );
}
