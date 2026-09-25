import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@sapporta/ui";
import { cn } from "@sapporta/ui/cn";
import type {
  FirstStatementRow,
  FirstStatements,
  RecognizedFinding,
  SampleFinding,
  UnreadableFinding,
} from "../../shared/index";
import { apiErrorMessage, setupApi } from "../api";
import { AgentActions, PromptText } from "../components/agent-prompt";
import { Disclosure } from "../components/disclosure";
import { EmptyState } from "../components/empty-state";
import { FactList, FactRow } from "../components/fact-table";
import { LoadError } from "../components/load-error";
import { StatusChip } from "../components/status-chip";
import { Button } from "../components/ui/button";
import { formatDateRange, joinNames, parserLabel } from "../format";
import { firstStatementsQuery, refreshSetup } from "../queries";
import { reviewHref } from "../review/routes";
import {
  sampleAmbiguousPrompt,
  sampleParserPrompt,
} from "../views/import-statements/agentPrompts";
import { OutcomeLine } from "../views/import-statements/cards";
import {
  describeProblems,
  type Problem,
} from "../views/import-statements/describeProblems";
import {
  balanceFact,
  importedSummary,
  importWaiting,
  numberFact,
  numberLabel,
  openingAmount,
  stillToImport,
  withFinding,
} from "./first-statements";
import { sendFirstStatement, uploadSample } from "./sample-upload";
import { SetupFrame, StepHeading } from "./SetupWizard";
import { SETUP_STEP_ROUTES } from "./steps";

/*
 * Step 3, first statements: one statement per bank or card. dbu6 reads it,
 * which sets up its format; takes the starting balance from it, asking only
 * when it prints none; and imports it. Each account is one row in one state,
 * read from the books; a statement no saved format reads goes to the coding
 * agent, and "Check again" brings it back to the import.
 */
export function StatementsStep() {
  const query = useQuery(firstStatementsQuery);
  const data = query.data;
  const remaining = data ? stillToImport(data.accounts) : 0;

  return (
    <SetupFrame step="statements">
      <StepHeading title="Import a statement for each account">
        dbu6 learns its format, sets the starting balance and imports it.
      </StepHeading>
      {query.isPending && <p className="text-body text-ink-meta">Loading…</p>}
      {query.isError && (
        <LoadError
          title="Couldn't load your banks and cards"
          message={apiErrorMessage(query.error)}
          retry={() => void query.refetch()}
        />
      )}
      {data && data.accounts.length === 0 && (
        <EmptyState
          title="Add a bank or card first"
          body="Its statement is imported here."
          action={
            <Button
              render={<Link to={SETUP_STEP_ROUTES.banks} />}
              nativeButton={false}
              variant="outline"
              size="sm"
            >
              Add banks and cards
            </Button>
          }
        />
      )}
      {data && data.accounts.length > 0 && (
        <>
          <AgentStrip categorizer={data.categorizer} />
          <ul className="mt-4 space-y-4">
            {data.accounts.map((row) => (
              <StatementRow key={row.account_id} row={row} />
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
            {remaining > 0 && (
              <span className="text-meta text-ink-meta">
                {remaining} still to import
              </span>
            )}
            <Button
              render={<Link to={SETUP_STEP_ROUTES.review} />}
              nativeButton={false}
              variant={remaining > 0 ? "outline" : "default"}
            >
              Next: Review
            </Button>
          </div>
        </>
      )}
    </SetupFrame>
  );
}

/** Who categorizes the import, in one line: the check the import makes. */
function AgentStrip({
  categorizer,
}: {
  categorizer: FirstStatements["categorizer"];
}) {
  if (categorizer.ready) {
    return (
      <p className="flex items-center gap-1.5 text-row text-ink-soft">
        Categorizing with {categorizer.name}
        <span aria-label="ready" className="text-primary">
          ✓
        </span>
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span title={categorizer.reason}>
        <StatusChip tone="attention">
          No coding agent: transactions import without categories
        </StatusChip>
      </span>
      <Link
        to="/settings"
        className="text-meta font-semibold text-primary underline-offset-4 hover:underline"
      >
        Settings
      </Link>
    </p>
  );
}

// What a row is doing that the books don't know yet.
type Busy = "reading" | "checking" | "importing";

// What stopped the last import, as /import words it, or the step's refusal.
type Stopped =
  | { kind: "problems"; problems: Problem[] }
  | { kind: "refused"; message: string };

/** One bank or card: its header, then exactly one state. */
function StatementRow({ row }: { row: FirstStatementRow }) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stopped, setStopped] = useState<Stopped | null>(null);
  const [numberAccepted, setNumberAccepted] = useState(false);
  const [typedBalance, setTypedBalance] = useState("");
  const [stillUnreadable, setStillUnreadable] = useState(false);
  const [dragging, setDragging] = useState(false);

  // A finding replaces the row's until the books say otherwise, so an upload
  // doesn't wait on every staged statement being read again.
  function showFinding(finding: SampleFinding) {
    client.setQueryData(firstStatementsQuery.queryKey, (old) =>
      old
        ? {
            ...old,
            accounts: old.accounts.map((one) =>
              one.account_id === row.account_id
                ? withFinding(one, finding)
                : one,
            ),
          }
        : old,
    );
  }

  async function run(what: Busy, work: () => Promise<void>) {
    setBusy(what);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      setMessage(apiErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  const upload = (file: File) =>
    run("reading", async () => {
      setStopped(null);
      setNumberAccepted(false);
      setTypedBalance("");
      setStillUnreadable(false);
      showFinding(await uploadSample(row.account_id, file));
    });

  const checkAgain = () =>
    run("checking", async () => {
      const finding = await setupApi.recheckSampleStatement({
        body: { account_id: row.account_id },
      });
      setStillUnreadable(finding.outcome !== "recognized");
      showFinding(finding);
    });

  const importIt = () =>
    run("importing", async () => {
      const amount = openingAmount(row.kind, typedBalance);
      const reply = await sendFirstStatement({
        account_id: row.account_id,
        ...(amount === null ? {} : { opening_amount: amount }),
        ...(numberAccepted ? { use_statement_number: true } : {}),
      });
      if (reply.kind === "refused") {
        setStopped({ kind: "refused", message: reply.refusal.error });
      } else if (reply.kind === "failed") {
        setStopped({
          kind: "problems",
          problems: describeProblems(reply.failure),
        });
      } else {
        setStopped(null);
      }
      // The format and the opening balance stay even when the import
      // stops, so the row is read again either way.
      await refreshSetup(client);
    });

  const chooseFile = () => input.current?.click();
  const fileInput = (
    <input
      ref={input}
      type="file"
      hidden
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void upload(file);
      }}
    />
  );

  // A file dropped on the row is uploaded, while it waits for one.
  const takesDrop =
    busy === null &&
    (row.status === "needs_statement" || row.status === "unreadable");
  const drop = takesDrop
    ? {
        onDragOver: (event: DragEvent) => {
          event.preventDefault();
          setDragging(true);
        },
        onDragLeave: () => setDragging(false),
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void upload(file);
        },
      }
    : {};

  return (
    <li
      {...drop}
      className={cn(
        "overflow-hidden rounded-card border bg-card shadow-card",
        dragging ? "border-primary" : "border-sap-border",
      )}
    >
      <h3 className="border-b border-sap-border bg-sap-nested px-4 py-2 text-row font-semibold text-foreground [overflow-wrap:anywhere]">
        {row.name}
        <span className="font-normal text-ink-meta">
          {" · "}
          {row.kind === "card" ? "Credit card" : "Bank account"}
        </span>
      </h3>
      <div className="px-4 py-3">
        {fileInput}
        {busy === "reading" ? (
          <Waiting>Reading the statement…</Waiting>
        ) : busy === "importing" ? (
          <Waiting>Importing and categorizing… This can take a minute.</Waiting>
        ) : stopped !== null && row.status === "read" ? (
          <ImportStopped
            stopped={stopped}
            tryAgain={() => void importIt()}
            chooseFile={chooseFile}
          />
        ) : row.status === "imported" ? (
          <Imported row={row} />
        ) : row.status === "read" ? (
          <Read
            row={row}
            finding={row.finding}
            numberAccepted={numberAccepted}
            acceptNumber={() => setNumberAccepted(true)}
            typedBalance={typedBalance}
            setTypedBalance={setTypedBalance}
            importIt={() => void importIt()}
            chooseFile={chooseFile}
          />
        ) : row.status === "unreadable" ? (
          <Unreadable
            row={row}
            finding={row.finding}
            checking={busy === "checking"}
            stillUnreadable={stillUnreadable}
            checkAgain={() => void checkAgain()}
            chooseFile={chooseFile}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button variant="outline" size="sm" onClick={chooseFile}>
              Upload statement
            </Button>
            <span className="text-meta text-ink-meta">
              PDF, Excel or CSV — a recent one
            </span>
          </div>
        )}
        {message && (
          <p
            role="alert"
            className="mt-2 text-meta text-destructive [overflow-wrap:anywhere]"
          >
            {message}
          </p>
        )}
      </div>
    </li>
  );
}

function Waiting({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="text-row text-ink-meta">
      {children}
    </p>
  );
}

function Imported({ row }: { row: FirstStatementRow }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <OutcomeLine tone="ok" className="font-semibold">
          Imported
        </OutcomeLine>
        <span className="tnum text-meta text-ink-meta">
          {importedSummary(row.activity)}
        </span>
      </div>
      {row.activity.drafts > 0 && (
        <Button
          render={<Link to={reviewHref(row.account_id)} />}
          nativeButton={false}
          variant="ghost"
          size="sm"
        >
          Review →
        </Button>
      )}
    </div>
  );
}

/** A statement a saved format reads: what it holds, and the import. */
function Read({
  row,
  finding,
  numberAccepted,
  acceptNumber,
  typedBalance,
  setTypedBalance,
  importIt,
  chooseFile,
}: {
  row: FirstStatementRow;
  finding: RecognizedFinding;
  numberAccepted: boolean;
  acceptNumber: () => void;
  typedBalance: string;
  setTypedBalance: (typed: string) => void;
  importIt: () => void;
  chooseFile: () => void;
}) {
  const number = numberFact(row, finding, numberAccepted);
  const balance = balanceFact(row.kind, finding);
  const numberRow = (
    <FactRow
      label={numberLabel(row.kind)}
      face={number.state === "differs" ? "words" : "figure"}
    >
      {number.state === "differs" ? (
        <span className="inline-flex flex-wrap items-center justify-end gap-x-2">
          <span className="text-attention-ink">
            Statement shows {number.printed}; you entered {number.own}
          </span>
          <Button variant="ghost" size="sm" onClick={acceptNumber}>
            Use the statement's
          </Button>
        </span>
      ) : (
        <>
          {number.value ?? "—"}
          <Mark ok={number.state === "saved"}>
            {number.state === "saved" ? "✓ saved" : "not on the statement"}
          </Mark>
        </>
      )}
    </FactRow>
  );
  const balanceRow =
    balance.state === "in_books" ? (
      <FactRow label="Balance" face="words">
        already in your books
      </FactRow>
    ) : balance.state === "from_statement" ? (
      <FactRow label={balance.label}>
        {balance.value}
        <Mark ok={false}>from the statement</Mark>
      </FactRow>
    ) : balance.state === "ask" ? (
      <FactRow label={balance.label} face="words">
        <span className="inline-flex flex-col items-end gap-1">
          <Input
            inputMode="decimal"
            aria-label={balance.label}
            value={typedBalance}
            placeholder="0.00"
            onChange={(event) => setTypedBalance(event.target.value)}
            className="tnum h-sap-ctl w-[160px] rounded-control text-right font-mono"
          />
          <span className="text-meta text-ink-meta">{balance.caption}</span>
        </span>
      </FactRow>
    ) : null;

  const waiting = importWaiting(row.kind, finding, {
    numberAccepted,
    typedBalance,
  });
  return (
    <div>
      <p className="mb-2 text-label uppercase text-ink-meta">Statement read</p>
      <FactList>
        {finding.period && (
          <FactRow label="Period">{formatDateRange(finding.period)}</FactRow>
        )}
        <FactRow label="Transactions">{finding.transactions}</FactRow>
        {numberRow}
        {balanceRow}
      </FactList>
      <div className="mt-3 flex flex-wrap items-start justify-end gap-2">
        <Button variant="ghost" onClick={chooseFile}>
          Use another file
        </Button>
        <Button waiting={waiting} onClick={importIt}>
          Import {finding.transactions}
        </Button>
      </div>
    </div>
  );
}

// A few words after a figure: "✓ saved" in the done colour, else meta.
function Mark({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "ml-1.5 font-sans text-meta font-normal",
        ok ? "text-primary" : "text-ink-meta",
      )}
    >
      {children}
    </span>
  );
}

/** A statement no saved format reads: hand it to the coding agent. */
function Unreadable({
  row,
  finding,
  checking,
  stillUnreadable,
  checkAgain,
  chooseFile,
}: {
  row: FirstStatementRow;
  finding: UnreadableFinding;
  checking: boolean;
  stillUnreadable: boolean;
  checkAgain: () => void;
  chooseFile: () => void;
}) {
  const prompt =
    finding.outcome === "ambiguous"
      ? sampleAmbiguousPrompt(row, finding)
      : sampleParserPrompt(row, finding);
  const formats =
    finding.outcome === "ambiguous" ? finding.parsers : finding.tried;
  return (
    <div>
      <p className="text-subheading text-foreground">
        dbu6 can't read this statement yet
      </p>
      <p className="mt-0.5 text-body text-ink-soft">
        Your coding agent can teach it the format; you approve its plan.
      </p>
      <div className="mt-3 flex flex-wrap items-start gap-2.5">
        <AgentActions
          standalone
          prompt={prompt}
          goal="Teach dbu6 this format"
        />
        <Button variant="outline" disabled={checking} onClick={checkAgain}>
          {checking ? "Checking…" : "Check again"}
        </Button>
        <Button variant="ghost" onClick={chooseFile}>
          Use another file
        </Button>
      </div>
      {stillUnreadable && !checking && (
        <p className="mt-2 text-meta text-ink-meta">
          Still can't read it. Let the agent finish, then check again.
        </p>
      )}
      <div className="mt-2">
        <Disclosure summary="Details">
          <p className="text-meta text-ink-soft">
            {formats.length === 0
              ? "No saved format takes this kind of file."
              : finding.outcome === "ambiguous"
                ? `Formats that all read it: ${joinNames(formats.map(parserLabel))}.`
                : `Formats tried: ${joinNames(formats.map(parserLabel))}.`}
          </p>
          <Disclosure tone="assist" summary="Show the prompt">
            <PromptText prompt={prompt} />
          </Disclosure>
        </Disclosure>
      </div>
    </div>
  );
}

/** What stopped the import, and the two ways on. */
function ImportStopped({
  stopped,
  tryAgain,
  chooseFile,
}: {
  stopped: Stopped;
  tryAgain: () => void;
  chooseFile: () => void;
}) {
  const buttons = (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={tryAgain}>
        Try again
      </Button>
      <Button variant="ghost" size="sm" onClick={chooseFile}>
        Use another file
      </Button>
    </div>
  );
  if (stopped.kind === "refused") {
    return (
      <div>
        <p
          role="alert"
          className="text-row text-destructive [overflow-wrap:anywhere]"
        >
          {stopped.message}
        </p>
        {buttons}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {stopped.problems.map((problem) => (
        <div key={problem.key}>
          <OutcomeLine tone={problem.tone} className="font-semibold">
            {problem.title}
          </OutcomeLine>
          {problem.fix && (
            <p className="mt-1 text-body text-foreground [overflow-wrap:anywhere]">
              {problem.fix}
            </p>
          )}
          {problem.agent && (
            <div className="mt-3">
              <AgentActions
                standalone
                prompt={problem.agent.prompt}
                afterwards={problem.agent.afterwards}
                goal={problem.agent.goal}
              />
            </div>
          )}
          {(problem.context || problem.technical) && (
            <div className="mt-2">
              <Disclosure summary="Details">
                {problem.context && (
                  <p className="text-body text-ink-soft">{problem.context}</p>
                )}
                {problem.technical && (
                  <pre className="whitespace-pre-wrap break-words font-mono text-meta text-ink-meta">
                    {problem.technical}
                  </pre>
                )}
              </Disclosure>
            </div>
          )}
        </div>
      ))}
      {buttons}
    </div>
  );
}
