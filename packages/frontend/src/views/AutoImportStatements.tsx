import { useRef, useState, type DragEvent } from "react";
import { AlertCircle, Loader2, Upload, X } from "lucide-react";
import { getApiBase } from "@sapporta/frontend/platform";
import { AppPage } from "@sapporta/frontend/shell";
import { ImportResultPanel, type ImportResult } from "./ImportStatement";

// Mirrors `autoImportFileSchema` / `importPlanSchema` / `autoImportErrorSchema`
// in packages/shared/src/contracts/import-drafts.ts.
type FileStatus = "matched" | "unrecognized" | "ambiguous";

interface PlanFile {
  file_name: string;
  status: FileStatus;
  parser_path?: string;
  account?: string;
  preset_name?: string;
  candidate_parser_paths?: string[];
  matching_parser_paths?: string[];
}

interface ImportPlan {
  account: string;
  account_kind: "bank" | "credit-card";
  files: PlanFile[];
}

interface AutoImportResult extends ImportResult {
  plan: ImportPlan;
}

interface AutoImportError {
  error: string;
  message: string | null;
  hint: string | null;
  detail: string | null;
  files: PlanFile[];
}

const ACCEPTED_EXTENSIONS = [".pdf", ".xls", ".csv", ".txt"];

function isAcceptedStatement(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}`;
}

function parseErrorBody(body: unknown, status: number): AutoImportError {
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const str = (key: string) =>
    typeof record[key] === "string" ? (record[key] as string) : null;
  const files = Array.isArray(record.files) ? (record.files as PlanFile[]) : [];
  return {
    error: str("error") ?? `HTTP ${status}`,
    message: str("message"),
    hint: str("hint"),
    detail: str("detail"),
    files,
  };
}

function parserLabel(parserPath: string): string {
  // custom-built-parsers/<name>/parser.py -> <name>
  const parts = parserPath.split("/");
  return parts.length >= 2 ? parts[parts.length - 2] : parserPath;
}

export function AutoImportStatements() {
  const [files, setFiles] = useState<File[]>([]);
  const [rejectedNames, setRejectedNames] = useState<string[]>([]);
  const [gpayFile, setGpayFile] = useState<File | null>(null);
  const [manualOpeningBalance, setManualOpeningBalance] = useState("");
  const [manualClosingBalance, setManualClosingBalance] = useState("");
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AutoImportResult | null>(null);
  const [error, setError] = useState<AutoImportError | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closingBalanceRef = useRef<HTMLInputElement>(null);

  const closingBalanceRequired = error?.error === "closing_balance_unavailable";
  const showBalanceInputs =
    closingBalanceRequired ||
    error?.error === "opening_balance_unavailable" ||
    manualOpeningBalance !== "" ||
    manualClosingBalance !== "";

  function addFiles(incoming: File[]) {
    const accepted = incoming.filter(isAcceptedStatement);
    const rejected = incoming.filter((f) => !isAcceptedStatement(f));
    setRejectedNames(rejected.map((f) => f.name));
    setFiles((prev) => {
      const seen = new Set(prev.map(fileKey));
      const fresh = accepted.filter((f) => !seen.has(fileKey(f)));
      return fresh.length === 0 ? prev : [...prev, ...fresh];
    });
    setResult(null);
    setError(null);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setResult(null);
    setError(null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (loading) return;
    addFiles(Array.from(event.dataTransfer.files));
  }

  async function handleSubmit() {
    if (files.length === 0 || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    for (const f of files) form.append("files", f);
    if (gpayFile) form.append("gpay", gpayFile);
    if (manualOpeningBalance.trim() !== "") {
      form.append("manual_opening_balance", manualOpeningBalance.trim());
    }
    if (manualClosingBalance.trim() !== "") {
      form.append("manual_closing_balance", manualClosingBalance.trim());
    }

    try {
      const res = await fetch(`${getApiBase()}/import-draft/statements/auto`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const parsed = parseErrorBody(body, res.status);
        setError(parsed);
        if (parsed.error === "closing_balance_unavailable") {
          requestAnimationFrame(() => closingBalanceRef.current?.focus());
        }
        return;
      }
      setResult((await res.json()) as AutoImportResult);
    } catch (err) {
      setError({
        error: "upload_failed",
        message: err instanceof Error ? err.message : "Upload failed",
        hint: null,
        detail: null,
        files: [],
      });
    } finally {
      setLoading(false);
    }
  }

  // Per-file annotations come from the plan on success, or from the
  // rejection payload when the server could say which files it recognised.
  const annotations = new Map<string, PlanFile>();
  for (const row of result?.plan.files ?? error?.files ?? []) {
    annotations.set(row.file_name, row);
  }

  const canSubmit = files.length > 0 && !loading;

  return (
    <AppPage section="Import" title="Import statements">
      <div className="p-8 max-w-2xl space-y-6">
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            Drop every statement you want to import. Each file is recognised on
            its own, so different banks and formats can go in together, as long
            as they all belong to one account.
          </p>
          <p>
            Imported transactions stay in Draft entries until you review their
            categories, duplicates, and balances. Nothing here changes the
            posted books.
          </p>
        </div>

        <div
          role="button"
          tabIndex={0}
          aria-label="Drop statement files here or press to browse"
          onClick={() => !loading && fileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (!loading) fileInputRef.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (!dragging) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragging
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/30 hover:border-primary/60"
          } ${loading ? "cursor-not-allowed opacity-60" : ""}`}
        >
          <Upload className="h-6 w-6 text-muted-foreground" />
          <div className="text-sm font-medium">
            Drop statements here, or click to browse
          </div>
          <div className="text-xs text-muted-foreground">
            PDF, XLS, CSV, or TXT. Add as many as you like before processing.
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS.join(",")}
            multiple
            disabled={loading}
            className="hidden"
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </div>

        {rejectedNames.length > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Skipped {rejectedNames.join(", ")}: only PDF, XLS, CSV, and TXT
            statements are accepted here.
          </p>
        )}

        {files.length > 0 && (
          <ul className="divide-y rounded-md border text-sm">
            {files.map((file, index) => {
              const row = annotations.get(file.name);
              return (
                <li
                  key={fileKey(file)}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono">{file.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {Math.round(file.size / 1024)} KB
                      </span>
                    </div>
                    {row && <FileAnnotation row={row} />}
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    disabled={loading}
                    onClick={() => removeFile(index)}
                    className="shrink-0 opacity-60 hover:opacity-100 disabled:cursor-not-allowed"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {error && error.files.length === 0 && <ErrorBanner error={error} />}
        {error && error.files.length > 0 && (
          <ErrorBanner error={error} compact />
        )}

        {showBalanceInputs && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">
              Enter the balances as printed on the statement. Opening applies to
              the earliest statement and closing to the latest.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label
                  htmlFor="auto-manual-opening-balance"
                  className="text-xs font-medium"
                >
                  Printed opening balance
                </label>
                <input
                  id="auto-manual-opening-balance"
                  inputMode="decimal"
                  value={manualOpeningBalance}
                  disabled={loading}
                  onChange={(event) =>
                    setManualOpeningBalance(event.target.value)
                  }
                  placeholder="Optional"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="auto-manual-closing-balance"
                  className="text-xs font-medium"
                >
                  Printed closing balance
                </label>
                <input
                  ref={closingBalanceRef}
                  id="auto-manual-closing-balance"
                  inputMode="decimal"
                  value={manualClosingBalance}
                  disabled={loading}
                  aria-invalid={closingBalanceRequired || undefined}
                  onChange={(event) =>
                    setManualClosingBalance(event.target.value)
                  }
                  placeholder={closingBalanceRequired ? "Required" : "Optional"}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-4">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading
              ? "Processing..."
              : files.length > 1
                ? `Process ${files.length} statements`
                : "Process"}
          </button>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Google Pay Takeout
            </summary>
            <div className="mt-2 space-y-1">
              <input
                id="auto-gpay-takeout-file"
                type="file"
                accept=".html,.htm"
                disabled={loading}
                onChange={(event) => {
                  setGpayFile(event.target.files?.[0] ?? null);
                  setResult(null);
                  setError(null);
                }}
                className="block w-full text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:text-primary-foreground hover:file:bg-primary/90"
              />
              <p className="text-xs text-muted-foreground">
                Optional. Prefixes matching UPI withdrawals with the recipient's
                name before categorization.
              </p>
              {gpayFile && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{gpayFile.name}</span> (
                  {Math.round(gpayFile.size / 1024)} KB)
                </p>
              )}
            </div>
          </details>
        </div>

        {result && (
          <div className="space-y-3">
            <PlanSummary plan={result.plan} />
            <ImportResultPanel
              result={result}
              isCreditCard={result.plan.account_kind === "credit-card"}
            />
          </div>
        )}
      </div>
    </AppPage>
  );
}

function FileAnnotation({ row }: { row: PlanFile }) {
  if (row.status === "matched") {
    return (
      <div className="mt-0.5 text-xs text-muted-foreground">
        {row.parser_path ? parserLabel(row.parser_path) : "recognised"}
        {row.account ? ` → ${row.account}` : ""}
      </div>
    );
  }
  if (row.status === "ambiguous") {
    return (
      <div className="mt-0.5 text-xs text-destructive">
        Matched more than one parser
        {row.matching_parser_paths && row.matching_parser_paths.length > 0
          ? `: ${row.matching_parser_paths.map(parserLabel).join(", ")}`
          : ""}
      </div>
    );
  }
  return (
    <div className="mt-0.5 text-xs text-destructive">
      Not recognised by any saved parser
    </div>
  );
}

function PlanSummary({ plan }: { plan: ImportPlan }) {
  const parsers = Array.from(
    new Set(
      plan.files
        .map((f) => f.parser_path)
        .filter((p): p is string => typeof p === "string"),
    ),
  ).map(parserLabel);
  return (
    <p className="text-sm text-muted-foreground">
      {plan.files.length === 1
        ? "1 statement"
        : `${plan.files.length} statements`}{" "}
      read with {parsers.join(", ")} into{" "}
      <span className="font-mono text-foreground">{plan.account}</span>
      {plan.account_kind === "credit-card" ? " (credit card)" : ""}.
    </p>
  );
}

function ErrorBanner({
  error,
  compact,
}: {
  error: AutoImportError;
  compact?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
      <div className="space-y-2">
        <div className="text-sm font-medium text-destructive">
          {compact ? "Could not process these statements" : "Import failed"}
        </div>
        {error.message && (
          <div className="break-words text-sm text-destructive/80">
            {error.message}
          </div>
        )}
        {error.detail && (
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-nested p-2 text-xs">
            {error.detail}
          </pre>
        )}
        {error.hint && (
          <div className="break-words border-t border-destructive/30 pt-2 text-sm text-foreground/80">
            {error.hint}
          </div>
        )}
      </div>
    </div>
  );
}
