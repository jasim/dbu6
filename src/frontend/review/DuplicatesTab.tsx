import { Link } from "react-router-dom";
import { postingCheck } from "../../shared/index";
import { reportsApi } from "../reports/client";
import { EmptyState } from "../components/empty-state";
import { duplicatesPrompt } from "./agentPrompts";
import { checkText, duplicatesText } from "./posting-checks";
import {
  AccountReport,
  AskYourAgent,
  ReportSummary,
  ReportTab,
} from "./report-tab";
import { useReviewAccount } from "./ReviewAccount";
import { reviewHref } from "./routes";

/**
 * The Duplicates tab (PLAN.md §11 P3): the drafts that look like another
 * draft or a posted entry, read-only, with a prompt to find out why.
 */
export function DuplicatesTab() {
  const { detail } = useReviewAccount();
  const { account } = detail;
  const check = postingCheck(account, "duplicates");

  if (check.state === "passes") {
    return (
      <ReportTab>
        <EmptyState
          className="max-w-[760px]"
          title={checkText(check)}
          body={`None of the drafts for ${account.name} match another draft or anything already in your books.`}
        />
      </ReportTab>
    );
  }

  return (
    <ReportTab>
      <ReportSummary>
        {duplicatesText(check.count)}. Each draft below looks like another draft
        or an entry already in your books. If one is extra, select it in{" "}
        <Link
          to={reviewHref(account.account_id, "drafts")}
          className="text-primary hover:underline"
        >
          Drafts
        </Link>{" "}
        and delete it. If both are real transactions, ask your coding agent to
        find out why they match.
      </ReportSummary>
      <AccountReport
        report="duplicate-drafts"
        accountId={account.account_id}
        call={() =>
          reportsApi.duplicateDrafts({
            query: { base_account_id: account.account_id },
          })
        }
      />
      <AskYourAgent
        title="Find out whether each pair is one transaction or two"
        prompt={duplicatesPrompt(detail)}
      />
    </ReportTab>
  );
}
