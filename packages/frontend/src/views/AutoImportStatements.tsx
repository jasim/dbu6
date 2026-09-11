import { useRef, useState, type DragEvent } from "react";
import { AlertCircle, Loader2, Upload, X } from "lucide-react";
import { getApiBase } from "@sapporta/frontend/platform";
import { AppPage } from "@sapporta/frontend/shell";
import type {
  AutoImportGroupResult,
  AutoImportPlanFile,
  AutoImportResult,
} from "dbu6-shared";
import { ImportResultPanel } from "./ImportStatement";

// An import that failed. `files` and `imported_groups` are present whenever
// the server got far enough to decide them; see `autoImportErrorSchema`.
interface AutoImportError {
  error: string;
  message: string | null;
  hint: string | null;
  detail: string | null;
  partialImport: string | null;
  files: AutoImportPlanFile[];
  importedGroups: AutoImportGroupResult[];
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
  const list = <T,>(key: string): T[] =>
    Array.isArray(record[key]) ? (record[key] as T[]) : [];
  return {
    error: str("error") ?? `HTTP ${status}`,
    message: str("message"),
    hint: str("hint"),
    detail: str("detail"),
    partialImport: str("partial_import"),
    files: list<AutoImportPlanFile>("files"),
    importedGroups: list<AutoImportGroupResult>("imported_groups"),
  };
}

// custom-built-parsers/<name>/parser.py -> <name>
function parserLabel(parserPath: string): string {
  const parts = parserPath.split("/");
  return parts.length >= 2 ? parts[parts.length - 2] : parserPath;
}

export function AutoImportStatements() {
  const [files, setFiles] = useState<File[]>([]);
  const [rejectedNames, setRejectedNames] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AutoImportResult | null>(null);
  const [error, setError] = useState<AutoImportError | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addFiles(incoming: File[]) {
    const accepted = incoming.filter(isAcceptedStatement);
    setRejectedNames(
      incoming.filter((f) => !isAcceptedStatement(f)).map((f) => f.name),
    );
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

    try {
      const res = await fetch(`${getApiBase()}/import-draft/statements/auto`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(parseErrorBody(body, res.status));
        return;
      }
      setResult((await res.json()) as AutoImportResult);
    } catch (err) {
      setError({
        error: "upload_failed",
        message: err instanceof Error ? err.message : "Upload failed",
        hint: null,
        detail: null,
        partialImport: null,
        files: [],
        importedGroups: [],
      });
    } finally {
      setLoading(false);
    }
  }

  // Every file the server decided on, whether or not anything was imported.
  const plannedFiles = result?.files ?? error?.files ?? [];
  const annotations = new Map(
    plannedFiles.map((row) => [row.file_name, row] as const),
  );
  const canSubmit = files.length > 0 && !loading;

  return (
    <AppPage section="Import" title="Import statements">
      <div className="p-8 max-w-2xl space-y-6">
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            Drop every statement you want to import. Each file is recognised on
            its own and matched to its import preset by the account it reports,
            so statements from several banks and accounts can go in together.
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

        {error && <ErrorBanner error={error} />}

        <div>
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
        </div>

        {error && error.importedGroups.length > 0 && (
          <GroupResults
            groups={error.importedGroups}
            heading="Imported before the failure"
          />
        )}
        {result && <GroupResults groups={result.groups} />}
      </div>
    </AppPage>
  );
}

function FileAnnotation({ row }: { row: AutoImportPlanFile }) {
  switch (row.status) {
    case "resolved":
      return (
        <div className="mt-0.5 text-xs text-muted-foreground">
          {parserLabel(row.parser_path)}
          {row.account ? ` · ${row.account.identifier}` : ""} → {row.preset_name}
        </div>
      );
    case "unrecognized":
      return (
        <div className="mt-0.5 text-xs text-destructive">
          No saved parser recognised this file
          {row.candidate_parser_paths.length > 0
            ? ` (tried ${row.candidate_parser_paths.map(parserLabel).join(", ")})`
            : ""}
          .
        </div>
      );
    case "ambiguous":
      return (
        <div className="mt-0.5 text-xs text-destructive">
          Matched more than one parser:{" "}
          {row.matching_parser_paths.map(parserLabel).join(", ")}.
        </div>
      );
    case "unresolved":
      return (
        <div className="mt-0.5 text-xs text-destructive">
          {parserLabel(row.parser_path)} read it, but no preset claims it:{" "}
          {row.message}
        </div>
      );
  }
}

function GroupResults({
  groups,
  heading,
}: {
  groups: AutoImportGroupResult[];
  heading?: string;
}) {
  return (
    <div className="space-y-4">
      {heading && <div className="text-sm font-medium">{heading}</div>}
      {groups.map((group) => (
        <div key={group.preset_name + group.base_account} className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {group.preset_name} ·{" "}
            <span className="font-mono text-foreground">
              {group.base_account}
            </span>
            {group.is_credit_card ? " (credit card)" : ""} ←{" "}
            {group.file_names.join(", ")}
          </p>
          <ImportResultPanel
            result={group.result}
            isCreditCard={group.is_credit_card}
          />
        </div>
      ))}
    </div>
  );
}

function ErrorBanner({ error }: { error: AutoImportError }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
      <div className="space-y-2">
        <div className="text-sm font-medium text-destructive">
          {error.files.length > 0
            ? "Could not process these statements"
            : "Import failed"}
        </div>
        {error.message && (
          <div className="break-words text-sm text-destructive/80">
            {error.message}
          </div>
        )}
        {error.partialImport && (
          <div className="break-words text-sm text-destructive/80">
            {error.partialImport}
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
