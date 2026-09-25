import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { FirstStatementRow } from "../../shared/index";
import { apiErrorMessage } from "../api";
import { EmptyState } from "../components/empty-state";
import { LinkCard } from "../components/link-card";
import { LoadError } from "../components/load-error";
import { Button } from "../components/ui/button";
import { firstStatementsQuery, setupStatusQuery } from "../queries";
import { reviewHref } from "../review/routes";
import { OPENING_BALANCES_ROUTE } from "../views/opening-balances/OpeningBalances";
import { SetupFrame, StepHeading } from "./SetupWizard";
import { SETUP_STEP_ROUTES, stepDone } from "./steps";

/*
 * Step 4, Review: the banks and cards whose first statements wait to be
 * checked, each opening in Review. Once every one is in and nothing waits,
 * the books are set up. Other starting balances (cash, investments, loans)
 * are optional, on their own screen.
 */
export function ReviewStep() {
  const status = useQuery(setupStatusQuery);
  const statements = useQuery(firstStatementsQuery);
  const done = status.data !== undefined && stepDone("review", status.data);
  const error = status.error ?? statements.error;

  return (
    <SetupFrame step="review">
      {done ? (
        <SetUp />
      ) : (
        <>
          <StepHeading title="Review and add to your books">
            Check each transaction's category. Nothing counts until you add it.
          </StepHeading>
          {error ? (
            <LoadError
              title="Couldn't load what waits to be reviewed"
              message={apiErrorMessage(error)}
              retry={() => {
                void status.refetch();
                void statements.refetch();
              }}
            />
          ) : status.data && statements.data ? (
            <ToReview rows={statements.data.accounts} />
          ) : (
            <p className="text-body text-ink-meta">Loading…</p>
          )}
        </>
      )}
    </SetupFrame>
  );
}

function ToReview({ rows }: { rows: readonly FirstStatementRow[] }) {
  const waiting = rows.filter((row) => row.activity.drafts > 0);
  if (waiting.length === 0) {
    return (
      <>
        <EmptyState
          title="Nothing to review yet"
          body="Import a statement for each bank or card, then check it here."
          action={
            <Button
              render={<Link to={SETUP_STEP_ROUTES.statements} />}
              nativeButton={false}
              variant="outline"
              size="sm"
            >
              Import your first statements
            </Button>
          }
        />
        <OtherBalances />
      </>
    );
  }
  const [first] = waiting;
  return (
    <>
      <WaitingTable rows={waiting} />
      <OtherBalances />
      <div className="mt-8 flex justify-end">
        <Button
          render={<Link to={reviewHref(first.account_id)} />}
          nativeButton={false}
        >
          Review {first.name}
        </Button>
      </div>
    </>
  );
}

function WaitingTable({ rows }: { rows: readonly FirstStatementRow[] }) {
  return (
    <div className="overflow-x-auto rounded-card border border-sap-border bg-card shadow-card">
      <table className="w-full text-row">
        <thead className="text-left text-meta text-ink-meta">
          <tr>
            <th scope="col" className="py-2.5 pl-4 pr-3 font-medium">
              Account
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              To review
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Need a category
            </th>
            <th scope="col" className="py-2.5 pl-3 pr-4">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.account_id} className="border-t border-line-inner">
              <td className="py-2.5 pl-4 pr-3 font-semibold text-foreground">
                {row.name}
              </td>
              <td className="tnum px-3 py-2.5 text-right font-mono">
                {row.activity.drafts}
              </td>
              <td className="tnum px-3 py-2.5 text-right font-mono">
                {row.activity.uncategorized > 0 ? (
                  row.activity.uncategorized
                ) : (
                  <span className="text-ink-meta">—</span>
                )}
              </td>
              <td className="whitespace-nowrap py-2.5 pl-3 pr-4 text-right">
                <Link
                  to={reviewHref(row.account_id)}
                  aria-label={`Review ${row.name}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Review →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Balances no statement brings in: optional, on their own screen. */
function OtherBalances() {
  return (
    <section className="mt-8">
      <h3 className="mb-2 text-label uppercase text-ink-meta">Optional</h3>
      <LinkCard
        label="Other starting balances"
        description="Cash, investments and loans have no statements. Record what they held."
        to={OPENING_BALANCES_ROUTE}
      />
    </section>
  );
}

/** Every bank or card is in, and nothing waits. */
function SetUp() {
  return (
    <>
      <div className="mb-5">
        <h2 className="flex items-center gap-2 text-heading text-foreground">
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded-full bg-primary text-[13px] text-primary-foreground"
          >
            ✓
          </span>
          Your books are set up
        </h2>
        <p className="mt-1 text-meta text-ink-meta">
          Each month, import the new statements.
        </p>
      </div>
      <OtherBalances />
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <Button render={<Link to="/" />} nativeButton={false} variant="ghost">
          Back to Home
        </Button>
        <Button render={<Link to="/import" />} nativeButton={false}>
          Import statements
        </Button>
      </div>
    </>
  );
}
