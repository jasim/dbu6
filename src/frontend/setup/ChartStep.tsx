import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LEDGER_ACCOUNT_TYPES, type ChartAccount } from "../../shared/index";
import { apiErrorMessage, setupApi } from "../api";
import { Disclosure } from "../components/disclosure";
import { LoadError } from "../components/load-error";
import { Button } from "../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import {
  chartOfAccountsQuery,
  chartSuggesterQuery,
  refreshSetup,
} from "../queries";
import { plural } from "../format";
import {
  countsByType,
  initialTicks,
  lockedAccounts,
  tickedAccounts,
  toggleTick,
  type Ticks,
} from "./chart-checklist";
import { ACCOUNT_TYPE_TERMS, ChartTree } from "./ChartTree";
import { DescribeMoney } from "./DescribeMoney";
import { SetupFrame, StepHeading } from "./SetupWizard";
import { SETUP_STEP_ROUTES } from "./steps";

/*
 * Step 1, the chart of accounts. Books with no accounts at all choose one:
 * the standard chart, or one the coding agent proposes from the user's
 * description, ticked through before anything is created. Books with any
 * account show their chart as it is; the Accounts page changes it.
 */
export function ChartStep() {
  const chart = useQuery(chartOfAccountsQuery);
  return (
    <SetupFrame step="accounts">
      {chart.isPending && (
        <p className="text-body text-ink-meta">Loading your accounts…</p>
      )}
      {chart.isError && (
        <LoadError
          title="Couldn't load your accounts"
          message={apiErrorMessage(chart.error)}
          retry={() => void chart.refetch()}
        />
      )}
      {chart.data?.state === "new" && (
        <NewChart
          starter={chart.data.starter.accounts}
          unticked={chart.data.unticked}
        />
      )}
      {chart.data?.state === "existing" && (
        <ExistingChart accounts={chart.data.chart.accounts} />
      )}
    </SetupFrame>
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

function NewChart({
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
  const setTicks = (next: Ticks) =>
    shown === described
      ? setDescribed({ ...described, ticks: next })
      : setStandard({ ...standard, ticks: next });

  async function create() {
    setCreating(true);
    setProblem(null);
    try {
      await setupApi.createChartOfAccounts({
        body: { accounts: tickedAccounts(accounts, ticks) },
      });
      await refreshSetup(client);
      navigate(SETUP_STEP_ROUTES.banks);
    } catch (error) {
      setProblem(refusalProblems(error));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <StepHeading title="Choose your chart of accounts">
        Every transaction is sorted into one of these. Rename or add more later.
      </StepHeading>

      <div className="mb-5">
        <ToggleGroup<Source>
          aria-label="Chart"
          value={[describing ? "describe" : "standard"]}
          onValueChange={(value) => {
            // Pressing the lit one again keeps it.
            const [picked] = value;
            if (picked !== undefined) setSource(picked);
          }}
        >
          <ToggleGroupItem<Source> value="standard">
            Standard chart
          </ToggleGroupItem>
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
          onProposal={(suggestion) =>
            setDescribed({
              accounts: suggestion.proposal.accounts,
              ticks: initialTicks(suggestion.proposal.accounts),
              notes: suggestion.notes,
            })
          }
          onBack={() => setSource("standard")}
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
          className="mb-4 rounded-card border border-destructive/40 px-4 py-3 text-body text-destructive"
        >
          {problem.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      <div className="flex min-h-sap-ctl flex-wrap items-center justify-between gap-3">
        <p className="text-meta text-ink-meta">
          <span className="tnum font-mono">{ticks.size}</span> of{" "}
          <span className="tnum font-mono">{accounts.length}</span> ticked
        </p>
        <Button onClick={() => void create()} disabled={creating}>
          {creating ? "Creating…" : `Create ${plural(ticks.size, "account")}`}
        </Button>
      </div>
    </>
  );
}

function ExistingChart({ accounts }: { accounts: ChartAccount[] }) {
  const counts = countsByType(accounts);
  return (
    <>
      <StepHeading title="Your chart of accounts">
        Your books already have {plural(accounts.length, "account")}. Change
        them on the{" "}
        <Link
          to="/accounts"
          className="text-primary underline-offset-4 hover:underline"
        >
          Accounts page
        </Link>
        .
      </StepHeading>
      <dl className="mb-5 flex flex-wrap items-baseline gap-x-5 gap-y-2">
        {LEDGER_ACCOUNT_TYPES.map((type) => (
          <div key={type} className="flex items-baseline gap-1.5">
            <dt className="text-label uppercase text-ink-meta">
              {ACCOUNT_TYPE_TERMS[type].term}
            </dt>
            <dd className="tnum font-mono text-row font-medium text-foreground">
              {counts[type]}
            </dd>
          </div>
        ))}
      </dl>
      <Disclosure
        summary="Show all accounts"
        aside={
          <Button
            render={<Link to={SETUP_STEP_ROUTES.banks} />}
            nativeButton={false}
          >
            Next: Banks & cards
          </Button>
        }
      >
        <ChartTree accounts={accounts} />
      </Disclosure>
    </>
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
