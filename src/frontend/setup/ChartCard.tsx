import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePageTitle } from "@sapporta/frontend/shell";
import type { ChartAccount } from "../../shared/index";
import { apiErrorMessage, setupApi } from "../api";
import { Disclosure } from "../components/disclosure";
import { Button } from "../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import {
  chartOfAccountsQuery,
  chartSuggesterQuery,
  refreshSetup,
} from "../queries";
import { plural } from "../format";
import {
  FocusCard,
  FocusLoading,
  type FocusFrame,
} from "../add-account/FocusCard";
import { addHref } from "../add-account/state";
import { contextLine } from "../add-account/words";
import {
  initialTicks,
  lockedAccounts,
  tickedAccounts,
  toggleTick,
  type Ticks,
} from "./chart-checklist";
import { ChartTree } from "./ChartTree";
import { DescribeMoney } from "./DescribeMoney";

/*
 * Card 1 of the first run (PLAN.md "The cards"), at `/setup`: books with no
 * accounts pick their chart, the standard one or one the coding agent
 * proposes from the user's description, ticked through before anything is
 * created. Books with a chart go Home, which resumes the first run from the
 * books; the Accounts page changes a chart.
 */

/** Card 1, the chart: first run only. */
export const SETUP_ROUTE = "/setup";

// The first run's context line, before any bank or card is in.
const FRAME: FocusFrame = {
  context: contextLine({ setup: true, from: null, added: null }, 0),
};

export function ChartCard() {
  usePageTitle("Set up your books");
  const chart = useQuery(chartOfAccountsQuery);
  if (!chart.data) {
    return (
      <FocusLoading
        {...FRAME}
        error={chart.isError ? chart.error : null}
        retry={() => void chart.refetch()}
      />
    );
  }
  if (chart.data.state === "existing") return <Navigate to="/" replace />;
  return (
    <Checklist
      starter={chart.data.starter.accounts}
      unticked={chart.data.unticked}
    />
  );
}

/** A chart on offer and what is ticked in it. */
interface Proposal {
  accounts: ChartAccount[];
  ticks: Ticks;
}

/** What the agent proposed, and what the server fixed in it. */
interface Described extends Proposal {
  notes: string[];
}

type Source = "standard" | "describe";

function Checklist({
  starter,
  unticked,
}: {
  starter: ChartAccount[];
  unticked: string[];
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const suggester = useQuery(chartSuggesterQuery);
  const agent = suggester.data?.ready ? suggester.data.name : null;
  const [source, setSource] = useState<Source>("standard");
  // Each source keeps its own chart and ticks, so switching loses neither.
  const [standard, setStandard] = useState<Proposal>(() => ({
    accounts: starter,
    ticks: initialTicks(starter, unticked),
  }));
  const [described, setDescribed] = useState<Described | null>(null);
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string[] | null>(null);

  const describing = source === "describe" && agent !== null;
  const shown = describing && described ? described : standard;
  const { accounts, ticks } = shown;
  // A refusal is about the chart that was sent: another chart, or other
  // ticks, leave it behind.
  const setTicks = (next: Ticks) => {
    setProblem(null);
    if (shown === described) setDescribed({ ...described, ticks: next });
    else setStandard({ ...standard, ticks: next });
  };
  const choose = (next: Source) => {
    setProblem(null);
    setSource(next);
  };

  async function create() {
    setCreating(true);
    setProblem(null);
    try {
      await setupApi.createChartOfAccounts({
        body: { accounts: tickedAccounts(accounts, ticks) },
      });
    } catch (error) {
      setProblem(refusalProblems(error));
      setCreating(false);
      return;
    }
    // On to card 2. `/setup` has nothing more to show these books, so Back
    // passes it.
    navigate(addHref({ setup: true }), { replace: true });
    void refreshSetup(client);
  }

  return (
    <FocusCard
      {...FRAME}
      title="Pick your chart of accounts"
      lead="Every transaction is sorted into one of these. Rename or add more later."
      actions={
        // Describing, Propose is the one thing to do until there is a
        // proposal to create.
        describing && described === null ? undefined : (
          <Button onClick={() => void create()} disabled={creating}>
            {creating ? "Creating…" : `Create ${plural(ticks.size, "account")}`}
          </Button>
        )
      }
    >
      <div className="mb-5">
        <ToggleGroup<Source>
          aria-label="Chart"
          value={[describing ? "describe" : "standard"]}
          onValueChange={(value) => {
            // Pressing the lit one again keeps it.
            const [picked] = value;
            if (picked !== undefined) choose(picked);
          }}
        >
          <ToggleGroupItem<Source> value="standard">Standard</ToggleGroupItem>
          <ToggleGroupItem<Source> value="describe" disabled={agent === null}>
            ✦ Describe your money
          </ToggleGroupItem>
        </ToggleGroup>
        {suggester.data && !suggester.data.ready && (
          <p className="mt-2 text-meta text-ink-meta">
            {withoutFullStop(suggester.data.reason)}.{" "}
            <Link
              to="/settings"
              className="text-primary underline-offset-4 hover:underline"
            >
              Settings
            </Link>
          </p>
        )}
        {suggester.isError && (
          <p className="mt-2 text-meta text-ink-meta">
            Couldn't check for a coding agent:{" "}
            {apiErrorMessage(suggester.error)}
          </p>
        )}
      </div>

      {describing && (
        <DescribeMoney
          agent={agent}
          current={() => tickedAccounts(accounts, ticks)}
          onProposal={(suggestion) => {
            setProblem(null);
            setDescribed({
              accounts: suggestion.proposal.accounts,
              ticks: initialTicks(suggestion.proposal.accounts),
              notes: suggestion.notes,
            });
          }}
        />
      )}
      {shown === described && described.notes.length > 0 && (
        <div className="mb-4">
          <Disclosure summary={plural(described.notes.length, "adjustment")}>
            <ul className="list-disc pl-5 text-meta text-ink-soft">
              {described.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </Disclosure>
        </div>
      )}

      <ChartTree
        accounts={accounts}
        checklist={{
          ticks,
          locked: lockedAccounts(accounts),
          onToggle: (name) => setTicks(toggleTick(accounts, ticks, name)),
        }}
      />

      {problem && (
        <div
          role="alert"
          className="rounded-card border border-destructive/40 px-4 py-3 text-body text-destructive"
        >
          {problem.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </FocusCard>
  );
}

// "No agent is ready." and "No agent is ready" both end in one full stop.
function withoutFullStop(sentence: string): string {
  return sentence.replace(/\.\s*$/, "");
}

// A refusal's problems, one per line, or what went wrong.
function refusalProblems(error: unknown): string[] {
  if (error && typeof error === "object" && "body" in error) {
    const body = (error as { body?: { problems?: unknown } }).body;
    if (Array.isArray(body?.problems) && body.problems.length > 0) {
      return body.problems.map(String);
    }
  }
  return [apiErrorMessage(error)];
}
