import { Link } from "react-router-dom";
import { needsCategoryHref } from "../../review/routes";
import type { CategorizationSummary } from "./describeCategorization";

/**
 * Who categorized an account's drafts, with the ones that remain linked to
 * where they are categorized: after an import and on Classify drafts.
 */
export function CategorizedLine({
  summary,
  accountId,
}: {
  summary: CategorizationSummary;
  accountId: number;
}) {
  return (
    <div>
      <p className="text-foreground">
        {summary.text}
        {summary.remain && (
          <>
            {" "}
            <Link
              to={needsCategoryHref(accountId)}
              className="text-primary hover:underline hover:underline-offset-4"
            >
              {summary.remain}
            </Link>
            .
          </>
        )}
      </p>
      {summary.sameAccount && (
        <p className="text-meta text-ink-meta">{summary.sameAccount}</p>
      )}
    </div>
  );
}
