import { z } from "zod";

/*
 * What an account's drafts hold, and the checks they must pass before they are
 * added to the books (PLAN.md §11 P3). The API's draft status module counts
 * them; each check's state is decided here from the counts, and the posting
 * gate, Update and Review all read it, so no screen decides on its own whether
 * drafts can be posted.
 *
 * Counts are the draft reports' rows: a draft that matches two others is two
 * possible duplicates.
 *
 * A balance check can rely on another account's drafts: a transfer or card
 * payment drafted from that account's statement and categorized to this one
 * counts in this account's running balance. The checks here count every
 * account's drafts. The posting gate counts only the drafts of the accounts
 * it adds together, so an account that relies on another goes in with it,
 * on Add all, and its own Add is refused naming that account (`relies_on`).
 * Which accounts a press adds is the posting workflow's to decide, and
 * Review reads it from there.
 */

export const draftCountsSchema = z.object({
  drafts: z.number(),
  /** Drafts with no account. */
  uncategorised: z.number(),
  /**
   * Drafts whose account is their own statement's account. Posting one would
   * write both lines on that account, netting to nothing, while its balance
   * checks count only the statement's side, so it needs another account too.
   */
  on_own_account: z.number(),
  duplicates: z.number(),
  /** Drafts carrying a balance the statement printed. */
  balance_checks: z.number(),
  failing_checks: z.number(),
});
export type DraftCounts = z.infer<typeof draftCountsSchema>;

/** An account, by id and by the name the screens give it. */
export const namedAccountSchema = z.object({
  account_id: z.number(),
  name: z.string(),
});
export type NamedAccount = z.infer<typeof namedAccountSchema>;

/** An account with no drafts. */
export const NO_DRAFTS: DraftCounts = {
  drafts: 0,
  uncategorised: 0,
  on_own_account: 0,
  duplicates: 0,
  balance_checks: 0,
  failing_checks: 0,
};

/**
 * The checks, in Review's tab order, which is also the order the posting gate
 * refuses in.
 */
export const POSTING_CHECK_KINDS = [
  "categorization",
  "duplicates",
  "balance-checks",
] as const;
export type PostingCheckKind = (typeof POSTING_CHECK_KINDS)[number];

/**
 * A check that blocks posting. A block is a problem when the numbers don't
 * add up (usually a wrong or missing statement), and needs attention when
 * drafts only need an account. A schema, since Add all answers with the
 * block that kept each account out.
 *
 * The categorization block's `count` is every draft that needs an account:
 * those with none, and `on_own_account`, those on their own statement's.
 *
 * The posting gate's own balance-checks block names `relies_on`: the
 * accounts not being added whose drafts the failing checks count, other
 * statements' drafts categorized to this account on or before its last
 * failing check. The checks decided from the counts name none.
 */
export const postingBlockSchema = z.union([
  z.object({
    kind: z.literal("categorization"),
    state: z.literal("blocks"),
    severity: z.literal("attention"),
    count: z.number(),
    on_own_account: z.number(),
  }),
  z.object({
    kind: z.literal("duplicates"),
    state: z.literal("blocks"),
    severity: z.literal("problem"),
    count: z.number(),
  }),
  z.object({
    kind: z.literal("balance-checks"),
    state: z.literal("blocks"),
    severity: z.literal("problem"),
    count: z.number(),
    relies_on: z.array(namedAccountSchema),
  }),
]);
export type PostingBlock = z.infer<typeof postingBlockSchema>;

/**
 * One check on an account's drafts: it passes, or it blocks posting.
 * Drafts that carry no balance check have none to pass, which doesn't block.
 */
export type PostingCheck =
  | { kind: "categorization"; state: "passes"; drafts: number }
  | { kind: "duplicates"; state: "passes" }
  | { kind: "balance-checks"; state: "none" }
  | { kind: "balance-checks"; state: "passes" }
  | PostingBlock;

export type ProblemBlock = Extract<PostingBlock, { severity: "problem" }>;

const CHECKS: {
  [Kind in PostingCheckKind]: (
    counts: DraftCounts,
  ) => Extract<PostingCheck, { kind: Kind }>;
} = {
  categorization: (counts) => {
    const count = counts.uncategorised + counts.on_own_account;
    return count > 0
      ? {
          kind: "categorization",
          state: "blocks",
          severity: "attention",
          count,
          on_own_account: counts.on_own_account,
        }
      : { kind: "categorization", state: "passes", drafts: counts.drafts };
  },
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
        relies_on: [],
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
