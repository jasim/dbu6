import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChartAccount } from "../../shared/index";
import { apiErrorMessage, setupApi } from "../api";
import { LoadError } from "../components/load-error";
import { Button } from "../components/ui/button";
import { chartOfAccountsQuery, refreshSetup } from "../queries";
import { plural } from "../format";
import {
  initialTicks,
  lockedAccounts,
  tickedAccounts,
  toggleTick,
  type Ticks,
} from "./chart-checklist";
import { ChartTree } from "./ChartTree";
import { DescribeMoney } from "./DescribeMoney";
import { SetupFrame, StepHeading } from "./SetupWizard";
import { SETUP_STEP_ROUTES } from "./steps";

/*
 * Step 1, the chart of accounts. Books with no accounts at all start from a
 * proposal the user ticks through before anything is created. Books with any
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

/** The proposal on screen and what is ticked in it. */
interface Proposal {
  accounts: ChartAccount[];
  ticks: Ticks;
  // What the server fixed in the LLM's proposal; null for the starter.
  notes: string[] | null;
}

function NewChart({
  starter,
  unticked,
}: {
  starter: ChartAccount[];
  unticked: string[];
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const starterProposal = (): Proposal => ({
    accounts: starter,
    ticks: initialTicks(starter, unticked),
    notes: null,
  });
  const [proposal, setProposal] = useState<Proposal>(starterProposal);
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string[] | null>(null);
  const { accounts, ticks, notes } = proposal;

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
      <StepHeading title="Pick the accounts to start with">
        Your books sort every rupee into these accounts. Untick what you don't
        need. After they are created, rename or add accounts on the Accounts
        page.
      </StepHeading>

      <DescribeMoney
        current={() => tickedAccounts(accounts, ticks)}
        onProposal={(suggestion) =>
          setProposal({
            accounts: suggestion.proposal.accounts,
            ticks: initialTicks(suggestion.proposal.accounts),
            notes: suggestion.notes,
          })
        }
      />

      {notes !== null && (
        <div className="mb-4 rounded-card border border-sap-border bg-card px-4 py-3">
          <p className="text-body text-foreground">
            The accounts below are proposed for what you wrote. Untick what you
            don't need, or describe more and ask again.{" "}
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => setProposal(starterProposal())}
            >
              Back to the starter chart
            </button>
          </p>
          {notes.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-meta text-ink-soft">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mb-3 flex min-h-sap-ctl flex-wrap items-center justify-between gap-3">
        <p className="text-body text-ink-soft">
          {plural(ticks.size, "account")} of {accounts.length} ticked
        </p>
        <Button onClick={() => void create()} disabled={creating}>
          {creating ? "Creating…" : "Create these accounts"}
        </Button>
      </div>
      {problem && (
        <div role="alert" className="mb-4 text-body text-destructive">
          {problem.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      <ChartTree
        accounts={accounts}
        checklist={{
          ticks,
          locked: lockedAccounts(accounts),
          onToggle: (name) =>
            setProposal({
              ...proposal,
              ticks: toggleTick(accounts, ticks, name),
            }),
        }}
      />
    </>
  );
}

function ExistingChart({ accounts }: { accounts: ChartAccount[] }) {
  return (
    <>
      <StepHeading title="Your chart of accounts">
        Your books already have these accounts. Rename, move or add accounts on
        the{" "}
        <Link
          to="/accounts"
          className="text-primary underline-offset-4 hover:underline"
        >
          Accounts page
        </Link>
        .
      </StepHeading>
      <div className="mb-4 flex justify-end">
        <Button
          render={<Link to={SETUP_STEP_ROUTES.banks} />}
          nativeButton={false}
        >
          Next: banks and cards
        </Button>
      </div>
      <ChartTree accounts={accounts} />
    </>
  );
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
