import { useId, useState } from "react";
import { Input } from "@sapporta/ui";
import type { AccountKind } from "../../shared/index";
import { AgentActions, PromptText } from "../components/agent-prompt";
import { Disclosure } from "../components/disclosure";
import { Button } from "../components/ui/button";
import { formatDate, joinNames } from "../format";
import { ledgerAmount } from "../setup/other-balances";
import {
  ambiguousPrompt,
  unrecognizedPrompt,
} from "../views/import-statements/agentPrompts";
import { OutcomeLine } from "../views/import-statements/cards";
import type {
  Problem,
  ProblemAction,
} from "../views/import-statements/describeProblems";
import { Choice, FocusCard, type FocusFrame } from "./FocusCard";
import type { Gap, Unreadable } from "./state";
import {
  addMonthsLabel,
  balanceTitle,
  gapTitle,
  lateStartTitle,
  startFromLabel,
} from "./words";

/*
 * The cards that show only when their condition applies (PLAN.md "The
 * cards", under 3), each alone: one question or one fact, one primary
 * button, and at most a quiet way or two beside it.
 */

/** /import's prompt for a file it can't read, pointing at its staged copy. */
function teachPrompt(file: Unreadable): { prompt: string; goal: string } {
  return file.status === "ambiguous"
    ? {
        prompt: ambiguousPrompt({
          status: "ambiguous",
          file_name: file.file_name,
          saved_path: file.saved_path,
          matching_parser_paths: file.matching_parser_paths,
        }),
        goal: "Tell the formats apart",
      }
    : {
        prompt: unrecognizedPrompt({
          status: "unrecognized",
          file_name: file.file_name,
          saved_path: file.saved_path,
          candidate_parser_paths: file.candidate_parser_paths,
        }),
        goal: "Teach dbu6 this format",
      };
}

/**
 * No parser reads a file, or several do: the coding agent writes or parts
 * them, and Check again reads the same files.
 */
export function Teach({
  frame,
  files,
  readable,
  stillUnreadable,
  onCheckAgain,
  onLeaveOut,
}: {
  frame: FocusFrame;
  files: readonly Unreadable[];
  /** The dropped files a parser did read. */
  readable: number;
  stillUnreadable: boolean;
  onCheckAgain: () => void;
  onLeaveOut: () => void;
}) {
  const [first] = files;
  const { prompt, goal } = teachPrompt(first);
  const one = files.length === 1;
  const title =
    readable === 0
      ? one
        ? "dbu6 can't read this statement yet"
        : "dbu6 can't read these statements yet"
      : one
        ? "dbu6 can't read one of these statements yet"
        : `dbu6 can't read ${files.length} of these statements yet`;
  return (
    <FocusCard
      {...frame}
      title={title}
      lead={
        first.status === "ambiguous"
          ? "More than one format claims it. Your coding agent can tell them apart. You approve its plan, then check again."
          : "Your coding agent can teach dbu6 its format. You approve its plan, then check again."
      }
      actions={
        <>
          {readable > 0 && (
            <Button variant="ghost" onClick={onLeaveOut}>
              {one ? "Leave it out" : "Leave them out"}
            </Button>
          )}
          <Button onClick={onCheckAgain}>Check again</Button>
        </>
      }
    >
      <p className="text-meta text-ink-meta [overflow-wrap:anywhere]">
        {joinNames(files.map((file) => file.file_name))}
      </p>
      <div className="mt-4">
        <AgentActions standalone prompt={prompt} goal={goal} />
      </div>
      {stillUnreadable && (
        <p role="status" className="mt-3 text-meta text-ink-meta">
          Still can't read it. Let the agent finish, then check again.
        </p>
      )}
      <div className="mt-2">
        <Disclosure tone="assist" summary="Show the prompt">
          <PromptText prompt={prompt} />
        </Disclosure>
      </div>
    </FocusCard>
  );
}

/**
 * The files are two or more accounts': one account per drop. The rest come
 * through Add another.
 */
export function Several({
  frame,
  title,
  first,
  onStart,
}: {
  frame: FocusFrame;
  title: string;
  /** The first account's name, which the button starts with. */
  first: string;
  onStart: () => void;
}) {
  return (
    <FocusCard
      {...frame}
      title={title}
      lead="Add one account's statements at a time."
      actions={<Button onClick={onStart}>Start with {first}</Button>}
    />
  );
}

/** The account has transactions: its statements go through Import. */
export function InBooks({
  frame,
  name,
  onImport,
}: {
  frame: FocusFrame;
  name: string;
  onImport: () => void;
}) {
  return (
    <FocusCard
      {...frame}
      title={`${name} is already in your books`}
      lead="Its statements go through Import."
      actions={<Button onClick={onImport}>Import these</Button>}
    />
  );
}

/** The statements hold no rows: nothing to start the account from. */
export function NoTransactions({
  frame,
  onStartOver,
}: {
  frame: FocusFrame;
  onStartOver: () => void;
}) {
  return (
    <FocusCard
      {...frame}
      title="These statements have no transactions"
      actions={<Button onClick={onStartOver}>Drop other files</Button>}
    />
  );
}

/**
 * The account's opening entry refuses these statements: the server's words,
 * and back to Drop for other files. Nothing here for an agent to fix.
 */
export function OpeningRefused({
  frame,
  error,
  onStartOver,
}: {
  frame: FocusFrame;
  error: string;
  onStartOver: () => void;
}) {
  return (
    <FocusCard
      {...frame}
      title="These statements can't start this account"
      lead={error}
      actions={<Button onClick={onStartOver}>Drop other files</Button>}
    />
  );
}

/** A statement between two of the files is missing. */
export function GapCard({
  frame,
  gap,
  onAddIt,
  onStartFrom,
}: {
  frame: FocusFrame;
  gap: Gap;
  onAddIt: () => void;
  onStartFrom: () => void;
}) {
  return (
    <FocusCard
      {...frame}
      title={gapTitle(gap)}
      actions={
        <>
          <Button variant="outline" onClick={onStartFrom}>
            {startFromLabel(gap.resumesIn)}
          </Button>
          <Button onClick={onAddIt}>Add it</Button>
        </>
      }
    />
  );
}

/** The statements start later than the month card 2 named. */
export function LateStart({
  frame,
  from,
  starts,
  onAddMore,
  onStartFrom,
}: {
  frame: FocusFrame;
  from: string;
  starts: string;
  onAddMore: () => void;
  onStartFrom: () => void;
}) {
  return (
    <FocusCard
      {...frame}
      title={lateStartTitle(from, starts)}
      actions={
        <>
          <Button variant="outline" onClick={onStartFrom}>
            {startFromLabel(starts)}
          </Button>
          <Button onClick={onAddMore}>{addMonthsLabel(from, starts)}</Button>
        </>
      }
    />
  );
}

/** The statements print no account number, so the kind is the user's. */
export function KindCard({
  frame,
  institution,
  onKind,
}: {
  frame: FocusFrame;
  institution: string;
  onKind: (kind: AccountKind) => void;
}) {
  const name = useId();
  const [kind, setKind] = useState<AccountKind | null>(null);
  const title = `Is ${institution === "" ? "this" : institution} a bank account or a credit card?`;
  return (
    <FocusCard
      {...frame}
      title={title}
      actions={
        <Button disabled={kind === null} onClick={() => kind && onKind(kind)}>
          Continue
        </Button>
      }
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">{title}</legend>
        <Choice
          name={name}
          checked={kind === "bank"}
          onCheck={() => setKind("bank")}
        >
          Bank account
        </Choice>
        <Choice
          name={name}
          checked={kind === "card"}
          onCheck={() => setKind("card")}
        >
          Credit card
        </Choice>
      </fieldset>
    </FocusCard>
  );
}

/**
 * The statements print no balance, and the account has no opening: what it
 * held, or what was owed on the card, the day before their first row.
 */
export function Balance({
  frame,
  name,
  kind,
  date,
  onAnswer,
}: {
  frame: FocusFrame;
  name: string;
  kind: AccountKind;
  date: string;
  /** The amount as the ledger takes it: owed is negative. */
  onAnswer: (amount: number) => void;
}) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const amount = ledgerAmount(kind === "card" ? "Liability" : "Asset", typed);
  return (
    <FocusCard
      {...frame}
      title={balanceTitle(name, kind, formatDate(date))}
      lead="The statements print no balance."
      actions={
        <Button
          disabled={amount === null}
          onClick={() => amount !== null && onAnswer(amount)}
        >
          Continue
        </Button>
      }
    >
      <label htmlFor={id} className="sr-only">
        {kind === "card" ? "Amount owed" : "Balance"}
      </label>
      <Input
        id={id}
        inputMode="decimal"
        value={typed}
        placeholder="0.00"
        onChange={(event) => setTyped(event.target.value)}
        className="tnum h-sap-ctl w-[200px] rounded-control text-right font-mono"
      />
    </FocusCard>
  );
}

/**
 * Any other refusal: the import's own problem, as /import shows it. When
 * /import hands the user a prompt for it, Check again reads the same files
 * once the agent is done; otherwise the problem's own fix is the way on.
 */
export function Refused({
  frame,
  problems,
  promptsAgent,
  onAction,
  onCheckAgain,
  onStartOver,
}: {
  frame: FocusFrame;
  problems: readonly Problem[];
  /** `refusalPromptsAgent` of the refusal. */
  promptsAgent: boolean;
  onAction: (action: ProblemAction) => void;
  onCheckAgain: () => void;
  onStartOver: () => void;
}) {
  const [first] = problems;
  const actions = problems.flatMap((problem) => problem.actions);
  // One primary, last: Check again when an agent has a prompt to act on,
  // else the problem's first fix, else starting over.
  const [firstAction, ...otherActions] = actions;
  const primaryAction = promptsAgent ? undefined : firstAction;
  const quietActions = primaryAction === undefined ? actions : otherActions;
  const actionButton = (action: ProblemAction, primary: boolean) => (
    <Button
      key={action.label}
      variant={primary ? "default" : "outline"}
      onClick={() => onAction(action)}
    >
      {action.label}
    </Button>
  );
  const startOverIsPrimary = !promptsAgent && primaryAction === undefined;
  return (
    <FocusCard
      {...frame}
      title={first?.title ?? "These statements can't be imported"}
      lead={first?.fix ?? undefined}
      actions={
        <>
          <Button
            variant={startOverIsPrimary ? "default" : "ghost"}
            onClick={onStartOver}
          >
            Start over
          </Button>
          {quietActions.map((action) => actionButton(action, false))}
          {primaryAction && actionButton(primaryAction, true)}
          {promptsAgent && <Button onClick={onCheckAgain}>Check again</Button>}
        </>
      }
    >
      {problems.map((problem, i) => (
        <div key={problem.key} className={i > 0 ? "mt-4" : undefined}>
          {i > 0 && (
            <>
              <OutcomeLine tone={problem.tone} className="font-semibold">
                {problem.title}
              </OutcomeLine>
              {problem.fix && (
                <p className="mt-1 text-body text-foreground">{problem.fix}</p>
              )}
            </>
          )}
          <ProblemBody problem={problem} />
        </div>
      ))}
    </FocusCard>
  );
}

function ProblemBody({ problem }: { problem: Problem }) {
  return (
    <div className="space-y-2">
      {problem.agent && (
        <AgentActions
          standalone
          prompt={problem.agent.prompt}
          afterwards={problem.agent.afterwards}
          goal={problem.agent.goal}
        />
      )}
      {(problem.context || problem.technical || problem.facts.length > 0) && (
        <Disclosure summary="Details">
          {problem.context && (
            <p className="text-body text-ink-soft">{problem.context}</p>
          )}
          {problem.facts.length > 0 && (
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-meta">
              {problem.facts.map((fact) => (
                <div key={fact.label} className="contents">
                  <dt className="text-ink-meta">{fact.label}</dt>
                  <dd className="tnum text-right text-foreground">
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {problem.technical && (
            <pre className="whitespace-pre-wrap break-words font-mono text-meta text-ink-meta">
              {problem.technical}
            </pre>
          )}
        </Disclosure>
      )}
    </div>
  );
}
