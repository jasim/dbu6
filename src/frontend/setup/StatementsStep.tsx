import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  PlusCircle,
} from "lucide-react";
import { cn } from "@sapporta/ui/cn";
import type {
  ImportPresetChange,
  SampleFinding,
  StatementFormatRow,
} from "../../shared/index";
import { apiErrorMessage, importPresetsApi, setupApi } from "../api";
import { AgentPrompt } from "../components/agent-prompt";
import { EmptyState } from "../components/empty-state";
import { LoadError } from "../components/load-error";
import { Button } from "../components/ui/button";
import { formatDateRange } from "../format";
import { refreshSetup, statementFormatsQuery } from "../queries";
import {
  sampleAmbiguousPrompt,
  sampleParserPrompt,
} from "../views/import-statements/agentPrompts";
import {
  OPENING_BALANCES_ROUTE,
  openingBalanceHref,
} from "../views/opening-balances/OpeningBalances";
import {
  findingChecks,
  rowChecks,
  type Check,
  type CheckState,
} from "./format-checks";
import { uploadSample } from "./sample-upload";
import { SetupFrame, StepHeading } from "./SetupWizard";
import { SETUP_STEP_ROUTES } from "./steps";

/*
 * Step 3, statement formats: one sample statement per bank or card. The
 * accounts still to set up come first, each with its Format and Number
 * marked and one action; the ready ones follow as a compact table. A sample
 * the saved parsers read shows what it would set, for the user to accept; one
 * they don't is staged, and the parser-writing prompt goes to the coding
 * agent. Nothing in a sample is imported.
 */
export function StatementsStep() {
  const query = useQuery(statementFormatsQuery);
  // The first date of each sample accepted here, for its opening balance.
  const [firstDates, setFirstDates] = useState<ReadonlyMap<number, string>>(
    new Map(),
  );
  const rows = query.data?.accounts;
  const toSetUp = rows?.filter((row) => row.status !== "ready") ?? [];
  const ready = rows?.filter((row) => row.status === "ready") ?? [];

  return (
    <SetupFrame step="statements">
      <StepHeading title="Statement formats">
        One recent statement per account teaches dbu6 its format. Nothing in it
        is imported.
      </StepHeading>
      {query.isPending && <p className="text-body text-ink-meta">Loading…</p>}
      {query.isError && (
        <LoadError
          title="Couldn't load your banks and cards"
          message={apiErrorMessage(query.error)}
          retry={() => void query.refetch()}
        />
      )}
      {rows && rows.length === 0 && (
        <EmptyState
          title="No banks or cards yet"
          body="Add the banks and cards you get statements from first."
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
      {rows && rows.length > 0 && (
        <div className="space-y-8">
          {toSetUp.length > 0 ? (
            <Section title="To set up" count={toSetUp.length}>
              <AccountList>
                {toSetUp.map((row) => (
                  <SetupRow
                    key={row.account_id}
                    row={row}
                    onAccepted={(date) =>
                      date &&
                      setFirstDates(
                        new Map(firstDates).set(row.account_id, date),
                      )
                    }
                  />
                ))}
              </AccountList>
            </Section>
          ) : (
            <p className="flex items-center gap-2 text-body text-foreground">
              <CheckCircle2 className="size-4 text-primary" aria-hidden />
              Every account's statements can be read.
            </p>
          )}
          {ready.length > 0 && (
            <Section title="Ready" count={ready.length}>
              <AccountList>
                {ready.map((row) => (
                  <ReadyRow
                    key={row.account_id}
                    row={row}
                    firstDate={firstDates.get(row.account_id) ?? null}
                  />
                ))}
              </AccountList>
            </Section>
          )}
          <div className="flex justify-end">
            <Button
              render={<Link to={OPENING_BALANCES_ROUTE} />}
              nativeButton={false}
              variant={toSetUp.length > 0 ? "outline" : "default"}
            >
              Next: opening balances
            </Button>
          </div>
        </div>
      )}
    </SetupFrame>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-label uppercase text-ink-meta">
        {title} <span className="tnum">{count}</span>
      </h3>
      {children}
    </section>
  );
}

// The columns both lists share, so the marks line up down the page. On a
// phone the cells stack and each mark carries its label instead.
const COLUMNS =
  "grid grid-cols-1 items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,1fr)_minmax(8rem,auto)]";

function AccountList({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-sap-border bg-card shadow-card">
      <div
        aria-hidden="true"
        className={cn(
          COLUMNS,
          "hidden px-4 py-2 text-meta text-ink-meta sm:grid",
        )}
      >
        <span>Account</span>
        <span>Format</span>
        <span>Number</span>
        <span />
      </div>
      <ul className="divide-y divide-line-inner border-t border-line-inner">
        {children}
      </ul>
    </div>
  );
}

function AccountCell({ row }: { row: StatementFormatRow }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium text-foreground">{row.name}</div>
      <div className="truncate text-meta text-ink-meta">
        {row.kind === "card" ? "Card" : "Bank"} · {row.institution}
      </div>
    </div>
  );
}

// --- Marks -------------------------------------------------------------

const MARK: Record<
  CheckState,
  { Icon: typeof Circle; className: string; label: string }
> = {
  set: { Icon: CheckCircle2, className: "text-primary", label: "set" },
  adds: {
    Icon: PlusCircle,
    className: "text-attention-ink",
    label: "added by the sample",
  },
  missing: {
    Icon: Circle,
    className: "text-waiting-marker",
    label: "missing",
  },
  waiting: { Icon: Clock, className: "text-ink-meta", label: "waiting" },
  conflict: {
    Icon: AlertTriangle,
    className: "text-destructive",
    label: "differs",
  },
};

/** One check as a label and a value, with its mark. */
function CheckItem({ check }: { check: Check }) {
  const { Icon, className, label } = MARK[check.state];
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-row">
      <Icon
        className={cn("size-3.5 shrink-0", className)}
        aria-label={`${check.label} ${label}`}
      />
      <span className="text-ink-meta sm:hidden">{check.label}</span>
      {check.value !== null ? (
        <span className="tnum truncate font-mono text-foreground">
          {check.value}
        </span>
      ) : (
        !check.note && <span className="text-ink-meta">—</span>
      )}
      {check.note && (
        <span className="truncate text-meta text-ink-meta">{check.note}</span>
      )}
    </span>
  );
}

// --- To set up -------------------------------------------------------------

function SetupRow({
  row,
  onAccepted,
}: {
  row: StatementFormatRow;
  onAccepted: (firstDate: string | null) => void;
}) {
  const client = useQueryClient();
  const [finding, setFinding] = useState<SampleFinding | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setProblem(null);
    try {
      await work();
    } catch (error) {
      setProblem(apiErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  const refresh = () => refreshSetup(client);
  const upload = (file: File) =>
    run("Reading…", async () => {
      setFinding(await uploadSample(row.account_id, file));
      await refresh();
    });
  const recheck = () =>
    run("Checking…", async () => {
      const again = await setupApi.recheckSampleStatement({
        body: { account_id: row.account_id },
      });
      setFinding(again);
      if (again.outcome !== "recognized") {
        throw new Error("No saved parser reads the sample yet.");
      }
    });
  const removeSample = () =>
    run("Removing…", async () => {
      await setupApi.removeSampleStatement({
        params: { accountId: row.account_id },
        body: {},
      });
      setFinding(null);
      await refresh();
    });
  const accept = (
    recognized: Extract<SampleFinding, { outcome: "recognized" }>,
    changes: ImportPresetChange[],
  ) =>
    run("Saving…", async () => {
      if (changes.length > 0) {
        await importPresetsApi.changeImportPresets({ body: { changes } });
      }
      setFinding(null);
      onAccepted(recognized.period?.first_date ?? null);
      await refresh();
    });

  // What waits for a coding agent: this visit's finding, or a sample staged
  // on an earlier one.
  const staged =
    finding && finding.outcome !== "recognized"
      ? finding
      : row.staged_sample !== null
        ? {
            outcome: "unrecognized" as const,
            saved_path: row.staged_sample,
            tried: null,
          }
        : null;
  const recognized = finding?.outcome === "recognized" ? finding : null;

  return (
    <li className="px-4 py-3">
      <div className={COLUMNS}>
        <AccountCell row={row} />
        {(recognized ? findingChecks(row, recognized) : rowChecks(row)).map(
          (check) => (
            <CheckItem key={check.label} check={check} />
          ),
        )}
        <div className="flex items-center gap-1 sm:justify-self-end">
          {busy ? (
            <span className="text-meta text-ink-meta">{busy}</span>
          ) : recognized ? null : staged ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void recheck()}
              >
                Check again
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void removeSample()}
              >
                Remove
              </Button>
            </>
          ) : (
            <SampleButton onFile={(file) => void upload(file)} />
          )}
        </div>
      </div>

      {recognized && (
        <SampleFindingBar
          finding={recognized}
          disabled={busy !== null}
          accept={(changes) => accept(recognized, changes)}
          dismiss={() => setFinding(null)}
        />
      )}
      {!recognized && staged && (
        <div className="mt-3">
          <AgentPrompt
            title="Have your coding agent write a parser for this statement"
            prompt={
              staged.outcome === "ambiguous"
                ? sampleAmbiguousPrompt(row, staged)
                : sampleParserPrompt(row, staged)
            }
          />
        </div>
      )}
      {problem && (
        <p
          role="alert"
          className="mt-2 text-meta text-destructive [overflow-wrap:anywhere]"
        >
          {problem}
        </p>
      )}
    </li>
  );
}

/** What a read sample would set, and the buttons that set it. */
function SampleFindingBar({
  finding,
  disabled,
  accept,
  dismiss,
}: {
  finding: Extract<SampleFinding, { outcome: "recognized" }>;
  disabled: boolean;
  accept: (changes: ImportPresetChange[]) => void;
  dismiss: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-control bg-sap-nested px-3 py-2">
      <span className="text-meta text-ink-meta">
        Sample read
        {finding.period && (
          <span className="tnum"> · {formatDateRange(finding.period)}</span>
        )}
      </span>
      <div className="ml-auto flex flex-wrap gap-2">
        {finding.keep_mine === null ? (
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => accept(finding.changes)}
          >
            Use this
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => accept(finding.changes)}
            >
              Use statement's number
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => accept(finding.keep_mine!)}
              title={`Statements printing ${finding.printed_identifier} won't match this account when imported.`}
            >
              Keep mine
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" disabled={disabled} onClick={dismiss}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function SampleButton({ onFile }: { onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => input.current?.click()}
      >
        Upload sample
      </Button>
    </>
  );
}

// --- Ready -----------------------------------------------------------------

function ReadyRow({
  row,
  firstDate,
}: {
  row: StatementFormatRow;
  firstDate: string | null;
}) {
  return (
    <li className={cn(COLUMNS, "px-4 py-2")}>
      <AccountCell row={row} />
      {rowChecks(row).map((check) => (
        <CheckItem key={check.label} check={check} />
      ))}
      <div className="sm:justify-self-end">
        {firstDate && (
          <Link
            to={openingBalanceHref(row.name, firstDate)}
            className="whitespace-nowrap text-meta text-primary underline-offset-4 hover:underline"
          >
            Opening balance
          </Link>
        )}
      </div>
    </li>
  );
}
