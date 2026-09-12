import { useRef, useState, type DragEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { getApiBase } from "@sapporta/frontend/platform";
import { AppPage } from "@sapporta/frontend/shell";
import type { AutoImportResult } from "dbu6-shared";
import { AccountCard, ProblemCard } from "./import-statements/cards";
import {
  describeBatch,
  describeFileStatus,
} from "./import-statements/describeBatch";
import {
  describeProblems,
  networkError,
  parseErrorBody,
  type AutoImportError,
  type ProblemAction,
} from "./import-statements/describeProblems";
import { joinNames } from "./import-statements/format";

const ACCEPTED_EXTENSIONS = [".pdf", ".xls", ".csv", ".txt"];

function isAcceptedStatement(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}`;
}

export function AutoImportStatements() {
  const [files, setFiles] = useState<File[]>([]);
  const [rejectedNames, setRejectedNames] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AutoImportResult | null>(null);
  const [error, setError] = useState<AutoImportError | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function clearOutcome() {
    setResult(null);
    setError(null);
  }

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
    clearOutcome();
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    clearOutcome();
  }

  function handleProblemAction(action: ProblemAction) {
    if (action.kind === "remove-files") {
      const drop = new Set(action.fileNames);
      setFiles((prev) => prev.filter((f) => !drop.has(f.name)));
    } else if (action.kind === "keep-only-files") {
      const keep = new Set(action.fileNames);
      setFiles((prev) => prev.filter((f) => keep.has(f.name)));
    }
    clearOutcome();
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
    clearOutcome();

    const form = new FormData();
    for (const f of files) form.append("files", f);

    try {
      const res = await fetch(`${getApiBase()}/import-draft/statements/auto`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const failure = parseErrorBody(body, res.status);
        // Accounts that imported before the failure are done: their files
        // leave the batch so a retry sends only what is left.
        const done = new Set(
          failure.importedGroups.flatMap((group) => group.file_names),
        );
        if (done.size > 0) {
          setFiles((prev) => prev.filter((f) => !done.has(f.name)));
        }
        setError(failure);
        return;
      }
      setResult((await res.json()) as AutoImportResult);
    } catch (err) {
      setError(
        networkError(err instanceof Error ? err.message : "Upload failed"),
      );
    } finally {
      setLoading(false);
    }
  }

  // Every file the server decided on, whether or not anything was imported.
  const plannedFiles = result?.files ?? error?.files ?? [];
  const annotations = new Map(
    plannedFiles.map((row) => [row.file_name, row] as const),
  );
  const importedGroups = result?.groups ?? error?.importedGroups ?? [];
  const importedFiles = new Set(
    importedGroups.flatMap((group) => group.file_names),
  );
  const failedFiles = new Set(error?.failedGroup?.file_names ?? []);
  const batch = describeBatch({ result, error });
  const problems = error ? describeProblems(error) : [];
  const canSubmit = files.length > 0 && !loading;

  return (
    <AppPage section="Import" title="Import statements">
      <div className="p-8 max-w-2xl space-y-6">
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            Drop the statement files you downloaded from your bank. Each file is
            matched to the right account automatically, so you can drop
            statements from several banks at once.
          </p>
          <p>
            New transactions go into Drafts for you to review. Nothing here
            changes your books until you post them.
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
              const status = row
                ? describeFileStatus(row, { importedFiles, failedFiles })
                : null;
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
                    {status && (
                      <div
                        className={`mt-0.5 text-xs ${
                          status.tone === "problem"
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {status.text}
                      </div>
                    )}
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

        {batch && (
          <div
            className={`flex items-start gap-3 rounded-md border p-4 ${
              batch.tone === "failure" || batch.tone === "partial"
                ? "border-destructive/50 bg-destructive/10"
                : "bg-nested"
            }`}
          >
            {batch.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
            ) : batch.tone === "nothing-new" ? (
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            ) : (
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            )}
            <div className="space-y-1 text-sm">
              <div className="font-medium">{batch.text}</div>
              {batch.removedFiles.length > 0 && (
                <div className="text-muted-foreground">
                  {joinNames(batch.removedFiles)}{" "}
                  {batch.removedFiles.length === 1 ? "has" : "have"} been taken
                  out of the list above. Fix the problem below and press Process
                  to import the rest.
                </div>
              )}
              {batch.tone === "failure" && (
                <div className="text-muted-foreground">
                  Your files are still in the list above. Once this is sorted
                  out, press Process again.
                </div>
              )}
            </div>
          </div>
        )}

        {problems.map((problem) => (
          <ProblemCard
            key={problem.key}
            problem={problem}
            onAction={handleProblemAction}
          />
        ))}

        {importedGroups.length > 0 && (
          <div className="space-y-4">
            {error && (
              <div className="text-sm font-medium">
                Imported before the failure
              </div>
            )}
            {importedGroups.map((group) => (
              <AccountCard
                key={group.preset_name + group.base_account}
                group={group}
              />
            ))}
          </div>
        )}
      </div>
    </AppPage>
  );
}
