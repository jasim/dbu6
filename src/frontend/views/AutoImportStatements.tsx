import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { usePageTitle } from "@sapporta/frontend/shell";
import { cn } from "@sapporta/ui/cn";
import { Screen, ScreenTitle } from "../components/screen";
import { Button } from "../components/ui/button";
import { plural } from "../format";
import { importDraftsApi } from "../api";
import {
  LiveImport,
  newProgressId,
  useCategorizerStatus,
  type Finale,
} from "../import-progress/LiveImport";
import { REVIEW_ROUTE } from "../review/routes";
import { AgentUnavailableDialog } from "./categorization/AgentUnavailableDialog";
import { agentUnavailable } from "./categorization/describeCategorization";
import {
  OutcomeLine,
  ProblemApart,
  ProblemDetail,
  ResultsCard,
  SetupStep,
} from "./import-statements/cards";
import {
  countChecks,
  describeBatch,
  describeFileStatus,
  newTransactionCount,
  type BatchCounts,
  type BatchSummary,
} from "./import-statements/describeBatch";
import {
  describeFileSetup,
  describeProblems,
  FREEFORM_IMPORT_ROUTE,
  placeProblems,
  problemTone,
  type ProblemAction,
} from "./import-statements/describeProblems";
import {
  carriedFiles,
  Dropzone,
  GooglePayOption,
  StatementTable,
  type StatementLine,
} from "./import-statements/files";
import {
  checkStatement,
  importedGroups,
  plannedFiles,
  sendStatements,
  type FileCheck,
  type ImportOutcome,
} from "./import-statements/outcome";

function fileKey(file: File): string {
  return `${file.name}:${file.size}`;
}

/** Where the screen is: choosing files, importing them, or showing how it went. */
type ImportRun =
  | { phase: "choosing" }
  // Its progress asked by `progressId`.
  | { phase: "importing"; progressId: string }
  | { phase: "finished"; outcome: ImportOutcome };

const CHOOSING: ImportRun = { phase: "choosing" };
const READING: FileCheck = { kind: "reading", previous: null };

/**
 * Import statements (PLAN.md §11 P2): each dropped file is read at once, so
 * its line says where it goes, or the step it needs first, such as setting
 * up a new format. One button then imports what is ready, its rows landing
 * in a live ledger as they are categorized, and files still to set up stay
 * in the list for later. Afterwards the page says what came in, or what
 * stopped it and what to do next.
 */
export function AutoImportStatements() {
  usePageTitle("Import statements");
  // Another screen may open the page with files (`importWithFiles`).
  const { state } = useLocation();
  const [files, setFiles] = useState<File[]>(() => carriedFiles(state));
  // What reading each file found, by `fileKey`.
  const [checks, setChecks] = useState<ReadonlyMap<string, FileCheck>>(
    () => new Map(),
  );
  // The latest reading asked of each file, so an older answer that comes
  // back late is dropped.
  const asked = useRef(new Map<string, number>());
  const [gpayFile, setGpayFile] = useState<File | null>(null);
  // Any change to the batch sets the run back to choosing, so a shown outcome
  // always describes the files as they were sent.
  const [run, setRun] = useState<ImportRun>(CHOOSING);
  const finale = useRef<Finale | null>(null);
  // Who categorizes, for the progress's steps; asked before the import.
  const categorizer = useCategorizerStatus();

  function check(file: File) {
    const key = fileKey(file);
    const ask = (asked.current.get(key) ?? 0) + 1;
    asked.current.set(key, ask);
    setChecks((prev) => {
      const last = prev.get(key);
      const previous =
        last?.kind === "read"
          ? last.row
          : last?.kind === "reading"
            ? last.previous
            : null;
      return new Map(prev).set(key, { kind: "reading", previous });
    });
    void checkStatement(file).then((found) => {
      if (asked.current.get(key) !== ask) return;
      setChecks((prev) => new Map(prev).set(key, found));
    });
  }

  // The files another screen opened the page with are read like a drop.
  const carriedRead = useRef(false);
  useEffect(() => {
    if (carriedRead.current) return;
    carriedRead.current = true;
    files.forEach(check);
    // Only the files the page opened with.
  }, []);

  function addFiles(incoming: File[]) {
    const have = new Set(files.map(fileKey));
    const fresh = incoming.filter((f) => !have.has(fileKey(f)));
    // A file dropped again once its format is set up is read again.
    const again = incoming.filter((f) => {
      const known = checks.get(fileKey(f));
      return have.has(fileKey(f)) && !isReady(known);
    });
    if (fresh.length > 0) setFiles((prev) => [...prev, ...fresh]);
    [...fresh, ...again].forEach(check);
    setRun(CHOOSING);
  }

  function forget(keys: Iterable<string>) {
    const gone = new Set(keys);
    for (const key of gone) asked.current.delete(key);
    setChecks((prev) => {
      const next = new Map(prev);
      for (const key of gone) next.delete(key);
      return next;
    });
  }

  function removeFiles(drop: (file: File) => boolean) {
    forget(files.filter(drop).map(fileKey));
    setFiles((prev) => prev.filter((f) => !drop(f)));
    setRun(CHOOSING);
  }

  function chooseGpayFile(file: File | null) {
    setGpayFile(file);
    setRun(CHOOSING);
  }

  function startOver() {
    setGpayFile(null);
    setRun(CHOOSING);
  }

  function handleProblemAction(action: ProblemAction) {
    if (action.kind === "remove-files") {
      const drop = new Set(action.fileNames);
      removeFiles((f) => drop.has(f.name));
    } else if (action.kind === "keep-only-files") {
      const keep = new Set(action.fileNames);
      removeFiles((f) => !keep.has(f.name));
    }
  }

  const lines = files.map((file) => ({
    file,
    check: checks.get(fileKey(file)) ?? READING,
  }));
  const counts = countChecks(lines.map((line) => line.check));
  const ready = lines
    .filter((line) => isReady(line.check))
    .map((line) => line.file);

  async function handleSubmit() {
    if (ready.length === 0 || run.phase === "importing") return;
    const sent = ready;
    const progressId = newProgressId();
    setRun({ phase: "importing", progressId });
    const outcome = await sendStatements(sent, gpayFile, progressId);
    // The rows' last answers, before the page says how it went.
    if (outcome.kind === "imported") await finale.current?.();
    // What imported leaves the list, so it holds only what is still to
    // import: everything sent, or the accounts done before a refusal.
    const done = new Set(
      outcome.kind === "imported"
        ? sent.map((f) => f.name)
        : importedGroups(outcome).flatMap((group) => group.file_names),
    );
    if (done.size > 0) removeFiles((f) => done.has(f.name));
    // The import read the files afresh; its reading is the latest.
    const reread = new Map(
      plannedFiles(outcome).map((row) => [row.file_name, row]),
    );
    setChecks((prev) => {
      const next = new Map(prev);
      for (const file of sent) {
        const row = reread.get(file.name);
        if (row && !done.has(file.name)) {
          next.set(fileKey(file), { kind: "read", row });
        }
      }
      return next;
    });
    setRun({ phase: "finished", outcome });
  }

  const loading = run.phase === "importing";
  const outcome = run.phase === "finished" ? run.outcome : null;
  // After a request that imported without failure, the page leads with what
  // happened, and the list keeps only the files still to set up.
  const imported = outcome?.kind === "imported" ? outcome.result : null;
  const failure = outcome?.kind === "failed" ? outcome.failure : null;
  const planned = outcome ? plannedFiles(outcome) : [];
  const groups = outcome ? importedGroups(outcome) : [];
  // Each refusal sits under the last of its files in the list.
  const placed = placeProblems(
    failure ? describeProblems(failure) : [],
    files.map((file) => file.name),
  );
  const failed =
    failure?.kind === "account-refused"
      ? {
          files: new Set(failure.refusal.failed_group.file_names),
          tone: problemTone(failure),
        }
      : null;

  const tableLines: StatementLine[] = lines.map(({ file, check: found }) => {
    const refusals = placed.under.get(file.name) ?? [];
    const row =
      found.kind === "read"
        ? found.row
        : found.kind === "reading"
          ? found.previous
          : null;
    const setup = row ? describeFileSetup(row) : null;
    return {
      key: fileKey(file),
      file,
      row,
      status: describeFileStatus(found, failed),
      detail:
        refusals.length > 0 ? (
          <div className="space-y-5">
            {refusals.map((problem) => (
              <ProblemDetail
                key={problem.key}
                problem={problem}
                onAction={handleProblemAction}
              />
            ))}
          </div>
        ) : found.kind === "unread" || setup ? (
          <SetupStep
            step={setup}
            checking={found.kind === "reading"}
            onTryAgain={() => check(file)}
            onAction={handleProblemAction}
          />
        ) : null,
    };
  });

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
      {outcome && imported && (
        <div className="mt-5 space-y-4">
          <div className="space-y-4">
            <Summary batch={describeBatch(outcome)} prominent />
            <DoneActions
              newTransactions={newTransactionCount(imported)}
              onStartOver={startOver}
            />
          </div>
          {groups.length > 0 && (
            <ResultsCard groups={groups} sources={planned} />
          )}
        </div>
      )}

      {!imported && !loading && (
        <div className="mt-5">
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

      {files.length > 0 && (
        <section className={imported ? "mt-10" : "mt-5"}>
          {imported && (
            <h2 className="mb-3 text-subheading text-foreground">
              Still to set up
            </h2>
          )}
          <StatementTable
            lines={tableLines}
            counts={counts}
            disabled={loading}
            onRemove={(file) =>
              removeFiles((f) => fileKey(f) === fileKey(file))
            }
            onClear={() => removeFiles(() => true)}
          />
          {!imported && (
            <div className="mt-3 px-1">
              <GooglePayOption
                file={gpayFile}
                disabled={loading}
                onChoose={chooseGpayFile}
                onRemove={() => chooseGpayFile(null)}
              />
            </div>
          )}
        </section>
      )}

      {placed.apart.length > 0 && (
        <div className="mt-4 space-y-4">
          {placed.apart.map((problem) => (
            <ProblemApart
              key={problem.key}
              problem={problem}
              onAction={handleProblemAction}
            />
          ))}
        </div>
      )}

      {run.phase === "importing" ? (
        <section
          aria-label="Importing"
          className="mt-5 rounded-card border border-sap-border bg-card px-5 py-6 shadow-card sm:px-7"
        >
          <LiveImport
            progressId={run.progressId}
            readProgress={readUploadProgress}
            firstStep="Read the statements"
            categorizer={categorizer}
            finale={finale}
          />
        </section>
      ) : (
        (files.length > 0 || !imported) && (
          <div className="mt-5 space-y-3">
            {outcome && failure && <Summary batch={describeBatch(outcome)} />}
            <ImportButton
              statements={files.length}
              counts={counts}
              onImport={() => void handleSubmit()}
            />
          </div>
        )
      )}

      {failure && groups.length > 0 && (
        <div className="mt-10 space-y-3">
          <h2 className="text-subheading text-foreground">
            Imported before this stopped
          </h2>
          <ResultsCard groups={groups} sources={planned} />
        </div>
      )}
      <AgentUnavailableDialog
        problem={agentUnavailable(
          groups.map((group) => group.result.categorization),
        )}
      />
    </Screen>
  );
}

function isReady(check: FileCheck | undefined): boolean {
  return check?.kind === "read" && check.row.status === "resolved";
}

// Until the agent check answers, the steps leave the agent out.

function readUploadProgress(progressId: string) {
  return importDraftsApi.statementsAutoProgress({
    params: { progressId },
    query: {},
  });
}

// Imports what is ready. With files still to set up, it says it imports
// only the ready ones; those others stay in the list.
function ImportButton({
  statements,
  counts,
  onImport,
}: {
  statements: number;
  counts: BatchCounts;
  onImport: () => void;
}) {
  const waiting =
    statements === 0
      ? "Add at least one statement"
      : counts.reading > 0
        ? "Reading your statements"
        : counts.ready === 0
          ? "Set up the statements above first"
          : undefined;
  const label =
    counts.ready === 0
      ? "Import statements"
      : counts.ready === statements
        ? counts.ready === 1
          ? "Import statement"
          : `Import ${counts.ready} statements`
        : `Import ${counts.ready} ready`;
  return (
    <Button onClick={onImport} waiting={waiting}>
      {label}
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

// The sentence that says what happened: over the list when the import
// stopped, and the page's headline, `prominent`, when it went through. A
// problem colours it in its tone; a success or an import with nothing new
// stays in ink.
function Summary({
  batch,
  prominent = false,
}: {
  batch: BatchSummary;
  prominent?: boolean;
}) {
  const quiet = batch.tone === "ok" || batch.tone === "waiting";
  return (
    <div role="status" className="min-w-0 space-y-1">
      <OutcomeLine
        tone={batch.tone}
        className={cn(
          prominent ? "text-heading" : "text-subheading",
          quiet && "text-foreground",
        )}
      >
        {batch.text}
      </OutcomeLine>
      {batch.next && <p className="text-body text-ink-soft">{batch.next}</p>}
    </div>
  );
}
