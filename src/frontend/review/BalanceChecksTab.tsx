import { Link } from "react-router-dom";
import { postingCheck } from "../../shared/index";
import { Button } from "../components/ui/button";
import { openingBalanceHref } from "../views/opening-balances/OpeningBalances";
import { reportsApi } from "../reports/client";
import { EmptyState } from "../components/empty-state";
import { formatMoney, formatShortDate } from "../format";
import { balanceChecksPrompt } from "./agentPrompts";
import { checkText, failingChecksText } from "./posting-checks";
import {
  AccountReport,
  AskYourAgent,
  ReportSummary,
  ReportTab,
} from "./report-tab";
import { useReviewAccount } from "./ReviewAccount";

// Why the tab is empty, under the check's own line.
const EMPTY_BODY = {
  none: "Drafts from a statement carry the statement's balances. These don't, so there's nothing to compare.",
  passes:
    "On every day the statement printed a balance, the drafts add up to it.",
};

/**
 * The Balance checks tab (PLAN.md §11 P3): the days the drafts' running
 * balance misses the statement's, read-only, with a prompt to find out why.
 */
export function BalanceChecksTab() {
  const { detail } = useReviewAccount();
  const { account, failing } = detail;
  const check = postingCheck(account, "balance-checks");

  if (check.state !== "blocks") {
    return (
      <ReportTab>
        <EmptyState
          className="max-w-[760px]"
          title={checkText(check)}
          body={EMPTY_BODY[check.state]}
        />
      </ReportTab>
    );
  }

  // A failing check is one of the detail's failing rows, in date order.
  const first = failing[0];
  return (
    <ReportTab>
      <ReportSummary>
        {failingChecksText(check.count)}.{" "}
        {check.count === 1 ? "It is" : "The first is"} on{" "}
        {formatShortDate(first.date)}, where the drafts' running balance is{" "}
        <span className="tnum font-mono">
          {formatMoney(Math.abs(first.diff))}
        </span>{" "}
        away from the statement's.
      </ReportSummary>
      {!detail.has_opening_entry && (
        <MissingOpeningBalance accountName={account.path} />
      )}
      <AccountReport
        report="draft-balance-assertions"
        accountId={account.account_id}
        call={() =>
          reportsApi.draftBalanceAssertions({
            query: { base_account_id: account.account_id },
          })
        }
      />
      <AskYourAgent
        title="Find out why the drafts miss the statement's balance"
        prompt={balanceChecksPrompt(detail)}
      />
    </ReportTab>
  );
}

/**
 * The usual cause when an account has no opening entry: every check is off by
 * the balance it started at. The screen it links to suggests the amount.
 */
function MissingOpeningBalance({ accountName }: { accountName: string }) {
  return (
    <section className="mt-4 flex max-w-[760px] flex-wrap items-center gap-x-6 gap-y-3 rounded-card border border-attention-border bg-attention-bg px-4 py-3">
      <div className="min-w-0 flex-1 basis-[280px]">
        <h2 className="text-row font-semibold text-attention-ink">
          No opening balance in your books
        </h2>
        <p className="mt-1 text-body text-ink-soft">
          Until {accountName} has one, every balance check on it is off by what
          it held or owed before its first transaction.
        </p>
      </div>
      <Button
        size="sm"
        render={<Link to={openingBalanceHref(accountName)} />}
        nativeButton={false}
      >
        Record the opening balance
      </Button>
    </section>
  );
}
