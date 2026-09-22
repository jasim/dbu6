import { z } from "zod";

/*
 * What an account's drafts hold, and the checks they must pass before they are
 * added to the books (PLAN.md §11 P3). The API's draft status module counts
 * them; each check's state is decided here from the counts, and the posting
 * gate, Home and Review all read it, so no screen decides on its own whether
 * drafts can be posted.
 *
 * Counts are the draft reports' rows: a draft that matches two others is two
 * possible duplicates.
 */

export const draftCountsSchema = z.object({
  drafts: z.number(),
  /** Drafts with no category. */
  uncategorised: z.number(),
  duplicates: z.number(),
  /** Drafts carrying a balance the statement printed. */
  balance_checks: z.number(),
  failing_checks: z.number(),
});
export type DraftCounts = z.infer<typeof draftCountsSchema>;

/** An account with no drafts. */
export const NO_DRAFTS: DraftCounts = {
  drafts: 0,
  uncategorised: 0,
  duplicates: 0,
  balance_checks: 0,
  failing_checks: 0,
};

/**
 * The checks, in Review's tab order, which is also the order the posting gate
 * refuses in.
 */
export const POSTING_CHECK_KINDS = [
  "categories",
  "duplicates",
  "balance-checks",
] as const;
export type PostingCheckKind = (typeof POSTING_CHECK_KINDS)[number];

/**
 * One check on an account's drafts: it passes, or it blocks posting with a
 * count. A block is a problem when the numbers don't add up (usually a wrong or
 * missing statement), and needs attention when drafts only need a category.
 * Drafts that carry no balance check have none to pass, which doesn't block.
 */
export type PostingCheck =
  | { kind: "categories"; state: "passes"; drafts: number }
  | {
      kind: "categories";
      state: "blocks";
      severity: "attention";
      count: number;
    }
  | { kind: "duplicates"; state: "passes" }
  | { kind: "duplicates"; state: "blocks"; severity: "problem"; count: number }
  | { kind: "balance-checks"; state: "none" }
  | { kind: "balance-checks"; state: "passes" }
  | {
      kind: "balance-checks";
      state: "blocks";
      severity: "problem";
      count: number;
    };

export type PostingBlock = Extract<PostingCheck, { state: "blocks" }>;
export type ProblemBlock = Extract<PostingBlock, { severity: "problem" }>;

const CHECKS: {
  [Kind in PostingCheckKind]: (
    counts: DraftCounts,
  ) => Extract<PostingCheck, { kind: Kind }>;
} = {
  categories: (counts) =>
    counts.uncategorised > 0
      ? {
          kind: "categories",
          state: "blocks",
          severity: "attention",
          count: counts.uncategorised,
        }
      : { kind: "categories", state: "passes", drafts: counts.drafts },
  duplicates: (counts) =>
    counts.duplicates > 0
      ? {
          kind: "duplicates",
          state: "blocks",
          severity: "problem",
          count: counts.duplicates,
        }
      : { kind: "duplicates", state: "passes" },
  "balance-checks": (counts) => {
    if (counts.failing_checks > 0) {
      return {
        kind: "balance-checks",
        state: "blocks",
        severity: "problem",
        count: counts.failing_checks,
      };
    }
    return counts.balance_checks === 0
      ? { kind: "balance-checks", state: "none" }
      : { kind: "balance-checks", state: "passes" };
  },
};

/** One check on the drafts these counts describe. */
export function postingCheck<Kind extends PostingCheckKind>(
  counts: DraftCounts,
  kind: Kind,
): Extract<PostingCheck, { kind: Kind }> {
  return CHECKS[kind](counts);
}

/** Every check, in tab order. */
export function postingChecks(counts: DraftCounts): PostingCheck[] {
  return POSTING_CHECK_KINDS.map((kind) => postingCheck(counts, kind));
}

/** The checks that block, in tab order; none when the drafts can be added. */
export function postingBlocks(counts: DraftCounts): PostingBlock[] {
  return postingChecks(counts).filter(isBlock);
}

export function isBlock(check: PostingCheck): check is PostingBlock {
  return check.state === "blocks";
}

export function isProblem(block: PostingBlock): block is ProblemBlock {
  return block.severity === "problem";
}
