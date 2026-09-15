import { reportsApi } from "../api";
import { EmptyState } from "../components/empty-state";
import { formatMoney, formatShortDate, plural } from "../format";
import { balanceChecksPrompt } from "./agentPrompts";
import {
  AccountReport,
  AskYourAgent,
  ReportSummary,
  ReportTab,
} from "./report-tab";
import { useReviewAccount } from "./ReviewAccount";

/**
 * The Balance checks tab (PLAN.md §11 P3): the days the drafts' running
 * balance misses the statement's, read-only, with a prompt to find out why.
 */
export function BalanceChecksTab() {
  const { detail } = useReviewAccount();
  const { account, failing } = detail;
  const first = failing[0];

  if (!first) {
    return (
      <ReportTab>
        {detail.balance_checks === 0 ? (
          <EmptyState
            className="max-w-[760px]"
            title="These drafts have no balance checks"
            body="Drafts from a statement carry the statement's balances. These don't, so there's nothing to compare."
          />
        ) : (
          <EmptyState
            className="max-w-[760px]"
            title="Every balance check passes"
            body="On every day the statement printed a balance, the drafts add up to it."
          />
        )}
      </ReportTab>
    );
  }

  return (
    <ReportTab>
      <ReportSummary>
        {plural(failing.length, "balance check")}{" "}
        {failing.length === 1 ? "fails. It is" : "fail. The first is"} on{" "}
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
      <AskYourAgent prompt={balanceChecksPrompt(detail)} />
    </ReportTab>
  );
}
