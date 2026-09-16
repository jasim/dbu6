import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { usePageTitle } from "@sapporta/frontend/shell";
import { cn } from "@sapporta/ui/cn";
import { Screen, ScreenTitle } from "../components/screen";
import { Button } from "../components/ui/button";
import { plural } from "../format";
import { REVIEW_ROUTE } from "../review/routes";
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
import {
  describeProblems,
  FREEFORM_IMPORT_ROUTE,
  problemTone,
  type ProblemAction,
} from "./import-statements/describeProblems";
import { Dropzone, FileRow, GooglePayRow } from "./import-statements/files";
import {
  importedGroups,
  plannedFiles,
  sendStatements,
  type ImportOutcome,
} from "./import-statements/outcome";

function fileKey(file: File): string {
  return `${file.name}:${file.size}`;
}

/** Where the screen is: choosing files, importing them, or showing how it went. */
type ImportRun =
  | { phase: "choosing" }
  | { phase: "importing" }
  | { phase: "finished"; outcome: ImportOutcome };

const CHOOSING: ImportRun = { phase: "choosing" };

/**
 * Import statements (PLAN.md §11 P2): drop the files, press one button, and
 * the server imports them in one request. Afterwards the page says what came
 * in, or what stopped it and how to fix that.
 */
export function AutoImportStatements() {
  usePageTitle("Import statements");
  const [files, setFiles] = useState<File[]>([]);
  const [gpayFile, setGpayFile] = useState<File | null>(null);
  // Any change to the batch sets the run back to choosing, so a shown outcome
  // always describes the files as they were sent.
  const [run, setRun] = useState<ImportRun>(CHOOSING);

  function addFiles(incoming: File[]) {
    setFiles((prev) => {
      const seen = new Set(prev.map(fileKey));
      const fresh = incoming.filter((f) => !seen.has(fileKey(f)));
      return fresh.length === 0 ? prev : [...prev, ...fresh];
    });
    setRun(CHOOSING);
  }

  function removeFile(file: File) {
    setFiles((prev) => prev.filter((f) => fileKey(f) !== fileKey(file)));
    setRun(CHOOSING);
  }

  function clearFiles() {
    setFiles([]);
    setRun(CHOOSING);
  }

  function chooseGpayFile(file: File | null) {
    setGpayFile(file);
    setRun(CHOOSING);
  }

  function startOver() {
    setFiles([]);
    setGpayFile(null);
    setRun(CHOOSING);
  }

  function handleProblemAction(action: ProblemAction) {
    if (action.kind === "remove-files") {
      const drop = new Set(action.fileNames);
      setFiles((prev) => prev.filter((f) => !drop.has(f.name)));
    } else if (action.kind === "keep-only-files") {
      const keep = new Set(action.fileNames);
      setFiles((prev) => prev.filter((f) => keep.has(f.name)));
    }
    setRun(CHOOSING);
  }

  async function handleSubmit() {
    if (files.length === 0 || run.phase === "importing") return;
    setRun({ phase: "importing" });
    const outcome = await sendStatements(files, gpayFile);
    if (outcome.kind === "failed") {
      // Accounts that imported before the failure are done: their files
      // leave the batch so a retry sends only what is left.
      const done = new Set(
        importedGroups(outcome).flatMap((group) => group.file_names),
      );
      if (done.size > 0) {
        setFiles((prev) => prev.filter((f) => !done.has(f.name)));
      }
    }
    setRun({ phase: "finished", outcome });
  }

  const loading = run.phase === "importing";
  const outcome = run.phase === "finished" ? run.outcome : null;
  // After a request that imported without failure, the page is a record of
  // what happened: nothing to add or remove, only what to do next.
  const imported = outcome?.kind === "imported" ? outcome.result : null;
  const failure = outcome?.kind === "failed" ? outcome.failure : null;
  const planned = outcome ? plannedFiles(outcome) : [];
  const annotations = new Map(
    planned.map((row) => [row.file_name, row] as const),
  );
  const groups = outcome ? importedGroups(outcome) : [];
  const importedFiles = new Set(groups.flatMap((group) => group.file_names));
  const failed =
    failure?.kind === "account-refused"
      ? {
          files: new Set(failure.refusal.failed_group.file_names),
          tone: problemTone(failure),
        }
      : null;
  const problems = failure ? describeProblems(failure) : [];

  return (
    <Screen
      width="narrow"
      header={
        <ScreenTitle title="Import statements">
          <p>
            Upload your bank or credit-card statements here. They'll be
            categorized automatically, and saved as Drafts for your review.
          </p>
        </ScreenTitle>
      }
    >
      {!imported && (
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
            {!imported && (
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
                onRemove={imported ? undefined : () => removeFile(file)}
              />
            );
          })}
          {!imported && (
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
        {imported ? (
          <DoneActions
            newTransactions={newTransactionCount(imported)}
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

      {outcome && (
        <div className="mt-10 space-y-5">
          <Summary batch={describeBatch(outcome)} />
          {problems.map((problem) => (
            <ProblemCard
              key={problem.key}
              problem={problem}
              onAction={handleProblemAction}
            />
          ))}
          {groups.length > 0 && (
            <div className="space-y-3">
              {failure && (
                <h2 className="text-subheading text-foreground">
                  Imported before the failure
                </h2>
              )}
              <ResultsCard groups={groups} sources={planned} />
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
      <Button render={<Link to={REVIEW_ROUTE} />} nativeButton={false}>
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
