import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ImportPresetChange,
  SampleFinding,
  StatementFormatRow,
  StatementFormatStatus,
} from "../../shared/index";
import { apiErrorMessage, importPresetsApi, setupApi } from "../api";
import { AgentPrompt } from "../components/agent-prompt";
import { EmptyState } from "../components/empty-state";
import { LoadError } from "../components/load-error";
import { StatusChip, type StatusTone } from "../components/status-chip";
import { Button } from "../components/ui/button";
import { formatDateRange, parserLabel } from "../format";
import { refreshSetup, statementFormatsQuery } from "../queries";
import {
  sampleAmbiguousPrompt,
  sampleParserPrompt,
} from "../views/import-statements/agentPrompts";
import {
  OPENING_BALANCES_ROUTE,
  openingBalanceHref,
} from "../views/opening-balances/OpeningBalances";
import { uploadSample } from "./sample-upload";
import { SetupFrame, StepHeading } from "./SetupWizard";
import { SETUP_STEP_ROUTES } from "./steps";

/*
 * Step 3, statement formats: one sample statement per bank or card. A
 * sample the saved parsers read is shown with the preset changes it
 * implies, which the user accepts; one they don't is staged, and the
 * parser-writing prompt goes to the coding agent. Nothing in a sample is
 * imported; importing stays on /import.
 */
export function StatementsStep() {
  const query = useQuery(statementFormatsQuery);
  // The first date of each sample accepted here, for its opening balance.
  const [firstDates, setFirstDates] = useState<ReadonlyMap<number, string>>(
    new Map(),
  );
  const rows = query.data?.accounts;
  return (
    <SetupFrame step="statements">
      <StepHeading title="Show dbu6 a statement of each">
        A recent statement of each bank account and card, as you download it
        from the bank. dbu6 learns what they look like; nothing in them is
        imported.
      </StepHeading>
      {query.isPending && (
        <p className="text-body text-ink-meta">Loading your banks and cards…</p>
      )}
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
        <>
          <div className="space-y-4">
            {rows.map((row) => (
              <FormatCard
                key={row.account_id}
                row={row}
                firstDate={firstDates.get(row.account_id) ?? null}
                onAccepted={(date) =>
                  date &&
                  setFirstDates(new Map(firstDates).set(row.account_id, date))
                }
              />
            ))}
          </div>
          <div className="mt-6 flex justify-end">
            <Button
              render={<Link to={OPENING_BALANCES_ROUTE} />}
              nativeButton={false}
            >
              Next: opening balances
            </Button>
          </div>
        </>
      )}
    </SetupFrame>
  );
}

const STATUS: Record<
  StatementFormatStatus,
  { tone: StatusTone; label: string }
> = {
  ready: { tone: "ok", label: "Ready" },
  needs_sample: { tone: "attention", label: "Needs a sample statement" },
  waiting_for_parser: { tone: "waiting", label: "Waiting for a parser" },
};

function FormatCard({
  row,
  firstDate,
  onAccepted,
}: {
  row: StatementFormatRow;
  firstDate: string | null;
  onAccepted: (firstDate: string | null) => void;
}) {
  const client = useQueryClient();
  const [finding, setFinding] = useState<SampleFinding | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const status = STATUS[row.status];

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
    run("Reading the sample…", async () => {
      setFinding(await uploadSample(row.account_id, file));
      await refresh();
    });
  const recheck = () =>
    run("Checking again…", async () => {
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

  return (
    <section className="rounded-card border border-sap-border bg-card px-4 py-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="text-subheading text-foreground">{row.name}</h3>
          <p className="mt-0.5 text-meta text-ink-meta">
            {row.kind === "card" ? "Card" : "Bank account"} at {row.institution}
            {row.account_identifiers.length > 0 && (
              <>
                {" · "}
                <span className="tnum font-mono">
                  {row.account_identifiers.join(", ")}
                </span>
              </>
            )}
          </p>
        </div>
        <StatusChip tone={status.tone}>{status.label}</StatusChip>
      </div>

      <div className="mt-3 space-y-3">
        {finding?.outcome === "recognized" ? (
          <RecognizedFinding
            row={row}
            finding={finding}
            disabled={busy !== null}
            accept={(changes) => accept(finding, changes)}
            dismiss={() => setFinding(null)}
          />
        ) : staged ? (
          <>
            <AgentPrompt
              title={`Have your coding agent write a parser for ${row.name}'s statements`}
              prompt={
                staged.outcome === "ambiguous"
                  ? sampleAmbiguousPrompt(row, staged)
                  : sampleParserPrompt(row, staged)
              }
              afterwards={
                <p className="text-body text-ink-soft">
                  When it says it is done, check the sample again.
                </p>
              }
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void recheck()}
              >
                Check again
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() => void removeSample()}
              >
                Remove the sample
              </Button>
            </div>
          </>
        ) : row.status === "ready" ? (
          <ReadyNote row={row} firstDate={firstDate} />
        ) : (
          <p className="text-body text-ink-soft">
            {row.parsers.length > 0
              ? `${row.institution}'s statements can be read, but ${row.name} has no number to tell its statements apart. A sample fills it in.`
              : `dbu6 can't read ${row.institution}'s statements yet.`}
          </p>
        )}

        {finding?.outcome !== "recognized" && !staged && (
          <SampleButton
            label={
              row.status === "ready"
                ? "Try another sample"
                : "Choose a sample statement"
            }
            quiet={row.status === "ready"}
            disabled={busy !== null}
            onFile={(file) => void upload(file)}
          />
        )}
        {busy && <p className="text-meta text-ink-meta">{busy}</p>}
        {problem && (
          <p
            role="alert"
            className="text-body text-destructive [overflow-wrap:anywhere]"
          >
            {problem}
          </p>
        )}
      </div>
    </section>
  );
}

function ReadyNote({
  row,
  firstDate,
}: {
  row: StatementFormatRow;
  firstDate: string | null;
}) {
  return (
    <p className="text-body text-ink-soft">
      Its statements are read with {row.parsers.map(parserLabel).join(", ")}.{" "}
      {firstDate && (
        <Link
          to={openingBalanceHref(row.name)}
          className="text-primary underline-offset-4 hover:underline"
        >
          Add its opening balance
        </Link>
      )}
    </p>
  );
}

function RecognizedFinding({
  row,
  finding,
  disabled,
  accept,
  dismiss,
}: {
  row: StatementFormatRow;
  finding: Extract<SampleFinding, { outcome: "recognized" }>;
  disabled: boolean;
  accept: (changes: ImportPresetChange[]) => void;
  dismiss: () => void;
}) {
  const printed = finding.printed_identifier;
  const typed = row.account_identifiers[0] ?? null;
  const lines = [
    `Read with ${parserLabel(finding.parser)}${finding.period ? `, ${formatDateRange(finding.period)}` : ""}.`,
    finding.moves
      ? `That parser already reads statements for ${finding.parser_institution}. A parser belongs to one institution, so ${row.name} moves to ${finding.institution}.`
      : finding.parser_institution === null
        ? `${finding.institution}'s statements will be read with it.`
        : null,
    {
      set: `The statement prints the number ${printed}; it becomes ${row.name}'s.`,
      same: `The statement prints ${printed}, the number you gave.`,
      different: `The statement prints ${printed}, but you gave ${typed}.`,
      none_printed: "The statement prints no account number.",
    }[finding.identifier_state],
  ].filter((line): line is string => line !== null);

  return (
    <div className="rounded-control border border-money-in-border bg-money-in-bg px-3 py-3">
      <ul className="space-y-1 text-body text-foreground">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {finding.keep_mine !== null && (
        <p className="mt-2 text-meta text-ink-soft">
          Keeping yours means statements printing {printed} won't be matched to{" "}
          {row.name} when you import them.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
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
              Use the statement's
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => accept(finding.keep_mine!)}
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

function SampleButton({
  label,
  quiet,
  disabled,
  onFile,
}: {
  label: string;
  quiet: boolean;
  disabled: boolean;
  onFile: (file: File) => void;
}) {
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
        variant={quiet ? "ghost" : "outline"}
        size="sm"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {label}
      </Button>
    </>
  );
}
