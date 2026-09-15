import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { getApiBase } from "@sapporta/frontend/platform";
import { usePageTitle } from "@sapporta/frontend/shell";
import type { AutoImportResult } from "dbu6-shared";
import { cn } from "@sapporta/ui/cn";
import { Screen, ScreenTitle } from "../components/screen";
import { Button } from "../components/ui/button";
import {
  OutcomeLine,
  ProblemCard,
  ResultsCard,
} from "./import-statements/cards";
import {
  describeBatch,
  describeFileStatus,
  newTransactionCount,
  type BatchSummary,
} from "./import-statements/describeBatch";
import { REVIEW_DRAFTS_ROUTE } from "./import-statements/describeGroup";
import {
  describeProblems,
  FREEFORM_IMPORT_ROUTE,
  networkError,
  parseErrorBody,
  problemTone,
  type AutoImportError,
  type ProblemAction,
} from "./import-statements/describeProblems";
import { Dropzone, FileRow, GooglePayRow } from "./import-statements/files";
import { plural } from "./import-statements/format";

function fileKey(file: File): string {
  return `${file.name}:${file.size}`;
}

/**
 * Import statements (PLAN.md §11 P2): drop the files, press one button, and
 * the server imports them in one request. Afterwards the page says what came
 * in, or what stopped it and how to fix that.
 */
export function AutoImportStatements() {
  usePageTitle("Import statements");
  const [files, setFiles] = useState<File[]>([]);
  const [gpayFile, setGpayFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AutoImportResult | null>(null);
  const [error, setError] = useState<AutoImportError | null>(null);

  function clearOutcome() {
    setResult(null);
    setError(null);
  }

  function addFiles(incoming: File[]) {
    setFiles((prev) => {
      const seen = new Set(prev.map(fileKey));
      const fresh = incoming.filter((f) => !seen.has(fileKey(f)));
      return fresh.length === 0 ? prev : [...prev, ...fresh];
    });
    clearOutcome();
  }

  function removeFile(file: File) {
    setFiles((prev) => prev.filter((f) => fileKey(f) !== fileKey(file)));
    clearOutcome();
  }

  function clearFiles() {
    setFiles([]);
    clearOutcome();
  }

  function chooseGpayFile(file: File | null) {
    setGpayFile(file);
    clearOutcome();
  }

  function startOver() {
    setFiles([]);
    setGpayFile(null);
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

  // After a request that imported without failure, the page is a record of
  // what happened: nothing to add or remove, only what to do next.
  const done = result !== null;
  // Every file the server decided on, whether or not anything was imported.
  const plannedFiles = result?.files ?? error?.files ?? [];
  const annotations = new Map(
    plannedFiles.map((row) => [row.file_name, row] as const),
  );
  const importedGroups = result?.groups ?? error?.importedGroups ?? [];
  const importedFiles = new Set(
    importedGroups.flatMap((group) => group.file_names),
  );
  const failed = error
    ? {
        files: new Set(error.failedGroup?.file_names ?? []),
        tone: problemTone(error),
      }
    : null;
  const batch = describeBatch({ result, error });
  const problems = error ? describeProblems(error) : [];

  return (
    <Screen
      width="narrow"
      header={
        <ScreenTitle title="Import statements">
          <p>
            Drop the statement files you downloaded from your bank. Each one is
            matched to its account, so you can drop statements from several
            banks at once. New transactions wait in Review, and your books don't
            change until you add them.
          </p>
        </ScreenTitle>
      }
    >
      {!done && (
        <div className="mt-8">
          <Dropzone disabled={loading} onFiles={addFiles} />
          <p className="mt-3 text-meta text-ink-meta">
            Transactions that aren't in a statement file?{" "}
            <Link
              to={FREEFORM_IMPORT_ROUTE}
              className="font-semibold text-primary no-underline hover:underline"
            >
              Import them freeform
            </Link>
          </p>
        </div>
      )}

      <section className="mt-8">
        {files.length > 0 && (
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-subheading text-foreground">
              {plural(files.length, "statement")}
            </h2>
            {!done && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={loading}
                onClick={clearFiles}
              >
                Clear all
              </Button>
            )}
          </div>
        )}
        <ul className="divide-y divide-line-inner rounded-card border border-sap-border bg-card">
          {files.map((file) => {
            const row = annotations.get(file.name);
            return (
              <FileRow
                key={fileKey(file)}
                file={file}
                status={
                  row
                    ? describeFileStatus(row, { importedFiles, failed })
                    : null
                }
                disabled={loading}
                onRemove={done ? undefined : () => removeFile(file)}
              />
            );
          })}
          {!done && (
            <GooglePayRow
              file={gpayFile}
              disabled={loading}
              onChoose={chooseGpayFile}
              onRemove={() => chooseGpayFile(null)}
            />
          )}
        </ul>
      </section>

      <div className="mt-6">
        {done ? (
          <DoneActions
            newTransactions={newTransactionCount(result)}
            onStartOver={startOver}
          />
        ) : (
          <ImportButton
            statements={files.length}
            loading={loading}
            onImport={() => void handleSubmit()}
          />
        )}
      </div>

      {batch && (
        <div className="mt-10 space-y-5">
          <Summary batch={batch} />
          {problems.map((problem) => (
            <ProblemCard
              key={problem.key}
              problem={problem}
              onAction={handleProblemAction}
            />
          ))}
          {importedGroups.length > 0 && (
            <div className="space-y-3">
              {error && (
                <h2 className="text-subheading text-foreground">
                  Imported before the failure
                </h2>
              )}
              <ResultsCard groups={importedGroups} sources={plannedFiles} />
            </div>
          )}
        </div>
      )}
    </Screen>
  );
}

function ImportButton({
  statements,
  loading,
  onImport,
}: {
  statements: number;
  loading: boolean;
  onImport: () => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <Button disabled>
          <Loader2 className="animate-spin" />
          Importing…
        </Button>
        <p role="status" className="text-meta text-ink-meta">
          Reading, checking and categorising. This can take a minute.
        </p>
      </div>
    );
  }
  return (
    <Button
      onClick={onImport}
      waiting={statements === 0 ? "Add at least one statement" : undefined}
    >
      {statements === 0
        ? "Import statements"
        : statements === 1
          ? "Import statement"
          : `Import ${statements} statements`}
    </Button>
  );
}

function DoneActions({
  newTransactions,
  onStartOver,
}: {
  newTransactions: number;
  onStartOver: () => void;
}) {
  if (newTransactions === 0) {
    return <Button onClick={onStartOver}>Import more statements</Button>;
  }
  return (
    <div className="flex flex-wrap gap-3">
      <Button render={<Link to={REVIEW_DRAFTS_ROUTE} />} nativeButton={false}>
        Review {plural(newTransactions, "transaction")}
      </Button>
      <Button variant="outline" onClick={onStartOver}>
        Import more statements
      </Button>
    </div>
  );
}

// The sentence that says what happened. A problem colours it in its tone;
// a success or an import with nothing new stays in ink.
function Summary({ batch }: { batch: BatchSummary }) {
  const quiet = batch.tone === "ok" || batch.tone === "waiting";
  return (
    <div role="status" className="space-y-1">
      <OutcomeLine
        tone={batch.tone}
        className={cn("text-subheading", quiet && "text-foreground")}
      >
        {batch.text}
      </OutcomeLine>
      {batch.next && <p className="text-body text-ink-soft">{batch.next}</p>}
    </div>
  );
}
