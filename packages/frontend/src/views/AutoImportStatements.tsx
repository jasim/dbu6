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
import { Button } from "../components/ui/button";
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
  const [gpayFile, setGpayFile] = useState<File | null>(null);
  const [rejectedNames, setRejectedNames] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AutoImportResult | null>(null);
  const [error, setError] = useState<AutoImportError | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gpayInputRef = useRef<HTMLInputElement>(null);

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

  function removeGpayFile() {
    setGpayFile(null);
    if (gpayInputRef.current) gpayInputRef.current.value = "";
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
    if (gpayFile) form.append("gpay", gpayFile);

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

  return (
    <AppPage section="Import" title="Import statements">
      <div className="p-8 max-w-2xl space-y-6">
        <div className="space-y-1 text-body text-ink-soft">
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
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragging
              ? "border-primary bg-primary/5"
              : "border-sap-border-strong hover:border-primary/60"
          } ${loading ? "cursor-not-allowed bg-waiting-bg text-waiting-fg" : ""}`}
        >
          <Upload className="h-6 w-6 text-muted-foreground" />
          <div className="text-row font-medium text-foreground">
            Drop statements here, or click to browse
          </div>
          <div className="text-meta text-ink-meta">
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
          <p className="text-meta text-attention-ink">
            Skipped {rejectedNames.join(", ")}: only PDF, XLS, CSV, and TXT
            statements are accepted here.
          </p>
        )}

        {files.length > 0 && (
          <ul className="divide-y rounded-card border text-row">
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
                      <span className="tnum shrink-0 font-mono text-meta text-ink-meta">
                        {Math.round(file.size / 1024)} KB
                      </span>
                    </div>
                    {status && (
                      <div
                        className={`mt-0.5 text-meta ${
                          status.tone === "problem"
                            ? "text-destructive"
                            : "text-ink-meta"
                        }`}
                      >
                        {status.text}
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${file.name}`}
                    disabled={loading}
                    onClick={() => removeFile(index)}
                    className="shrink-0"
                  >
                    <X />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-1">
          <label
            htmlFor="gpay-takeout-file"
            className="text-row font-medium text-foreground"
          >
            Google Pay Takeout (optional)
          </label>
          <input
            id="gpay-takeout-file"
            ref={gpayInputRef}
            type="file"
            accept=".html,.htm"
            disabled={loading}
            aria-describedby="gpay-takeout-help"
            onChange={(event) => {
              setGpayFile(event.target.files?.[0] ?? null);
              clearOutcome();
            }}
            className="block w-full text-row file:mr-3 file:py-1.5 file:px-3 file:rounded-control file:border file:border-sap-border-strong file:bg-card file:text-row file:font-semibold file:text-foreground hover:file:bg-muted file:cursor-pointer"
          />
          <p id="gpay-takeout-help" className="text-meta text-ink-meta">
            The activity page from your Google Pay Takeout. UPI payments in the
            statements above that match it get the recipient's name before they
            are categorised. It never changes which transactions count as
            already imported.
          </p>
          {gpayFile && (
            <div className="flex items-center gap-2 text-meta text-ink-meta">
              <span className="truncate font-mono">{gpayFile.name}</span>
              <span className="tnum shrink-0 font-mono">
                {Math.round(gpayFile.size / 1024)} KB
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove ${gpayFile.name}`}
                disabled={loading}
                onClick={removeGpayFile}
                className="shrink-0"
              >
                <X />
              </Button>
            </div>
          )}
        </div>

        <div>
          <Button
            onClick={handleSubmit}
            waiting={files.length === 0 ? "Add at least one file" : undefined}
            disabled={loading}
          >
            {loading && <Loader2 className="animate-spin" />}
            {loading
              ? "Processing..."
              : files.length > 1
                ? `Process ${files.length} statements`
                : "Process"}
          </Button>
        </div>

        {batch && (
          <div
            className={`flex items-start gap-3 rounded-card border p-4 ${
              batch.tone === "failure" || batch.tone === "partial"
                ? "border-destructive/30 bg-destructive/10"
                : "bg-muted"
            }`}
          >
            {batch.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-money-in" />
            ) : batch.tone === "nothing-new" ? (
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            ) : (
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            )}
            <div className="space-y-1 text-row">
              <div className="font-medium text-foreground">{batch.text}</div>
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
              <div className="text-row font-medium text-foreground">
                Imported before the failure
              </div>
            )}
            {importedGroups.map((group) => (
              <AccountCard
                key={group.preset_name + group.base_account}
                group={group}
                sources={plannedFiles}
              />
            ))}
          </div>
        )}
      </div>
    </AppPage>
  );
}
