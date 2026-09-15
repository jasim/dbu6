import { z } from "zod";

/*
 * What an account's drafts hold, and what stops them being added to the books
 * (PLAN.md §11 P3). The API's draft status module counts them; the posting
 * gate refuses on `postingBlocks`, and Home and Review read the same blocks,
 * so no screen decides on its own whether drafts can be posted.
 *
 * Counts are the draft reports' rows: a draft that matches two others is two
 * possible duplicates.
 */

export const draftCountsSchema = z.object({
  drafts: z.number(),
  /** Drafts with no category. */
  uncategorised: z.number(),
  duplicates: z.number(),
  failing_checks: z.number(),
});
export type DraftCounts = z.infer<typeof draftCountsSchema>;

/** An account with no drafts. */
export const NO_DRAFTS: DraftCounts = {
  drafts: 0,
  uncategorised: 0,
  duplicates: 0,
  failing_checks: 0,
};

/**
 * One thing that stops the drafts being added. A problem means the numbers
 * don't add up (usually a wrong or missing statement), so it comes before
 * attention: drafts that only need a category.
 */
export type PostingBlock =
  | { kind: "uncategorised"; severity: "attention"; count: number }
  | { kind: "duplicates"; severity: "problem"; count: number }
  | { kind: "failing-checks"; severity: "problem"; count: number };

export type ProblemBlock = Extract<PostingBlock, { severity: "problem" }>;

/**
 * The blocks in Review's tab order (categories, duplicates, balance checks),
 * which is also the order the posting gate refuses in. None when the drafts
 * can be added. Drafts that carry no balance check are not blocked.
 */
export function postingBlocks(counts: DraftCounts): PostingBlock[] {
  const blocks: PostingBlock[] = [];
  if (counts.uncategorised > 0) {
    blocks.push({
      kind: "uncategorised",
      severity: "attention",
      count: counts.uncategorised,
    });
  }
  if (counts.duplicates > 0) {
    blocks.push({
      kind: "duplicates",
      severity: "problem",
      count: counts.duplicates,
    });
  }
  if (counts.failing_checks > 0) {
    blocks.push({
      kind: "failing-checks",
      severity: "problem",
      count: counts.failing_checks,
    });
  }
  return blocks;
}

export function isProblem(block: PostingBlock): block is ProblemBlock {
  return block.severity === "problem";
}

/** The block of one kind, when the drafts have it. */
export function findBlock<K extends PostingBlock["kind"]>(
  blocks: readonly PostingBlock[],
  kind: K,
): Extract<PostingBlock, { kind: K }> | undefined {
  return blocks.find(
    (block): block is Extract<PostingBlock, { kind: K }> => block.kind === kind,
  );
}
