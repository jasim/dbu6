import { postingCheck } from "dbu6-shared";
import { reportsApi } from "../api";
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
