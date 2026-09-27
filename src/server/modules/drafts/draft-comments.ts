import { and, eq, isNull, sql } from "drizzle-orm";
import { Temporal } from "@sapporta/shared/temporal";
import { draftTransactionsTable } from "../../schema/draft-journals.js";

/*
 * The comment writer's drafts. It fills whatever comment is still null, in
 * every user's books, since it runs for the machine, not for a request: so
 * these read and write every draft, unscoped. A comment is a function of the
 * source narration alone, so one text's comment is the same in any books.
 */

const uncommented = and(
  isNull(draftTransactionsTable.comment),
  sql`trim(${draftTransactionsTable.source_narration}) <> ''`,
);

/** The source narrations of drafts with no comment yet, each once, oldest first. */
export function uncommentedDraftTexts(db: any): string[] {
  return db
    .select({ text: draftTransactionsTable.source_narration })
    .from(draftTransactionsTable)
    .where(uncommented)
    .groupBy(draftTransactionsTable.source_narration)
    .orderBy(sql`min(${draftTransactionsTable.id})`)
    .all()
    .map((row: { text: string }) => row.text);
}

/**
 * Gives every draft with `sourceNarration` and no comment `comment`. A draft
 * whose comment someone wrote meanwhile keeps it. Returns how many changed.
 */
export function writeDraftComment(
  db: any,
  sourceNarration: string,
  comment: string,
): number {
  return db
    .update(draftTransactionsTable)
    .set({ comment, updated_at: Temporal.Now.instant() })
    .where(
      and(
        isNull(draftTransactionsTable.comment),
        eq(draftTransactionsTable.source_narration, sourceNarration),
      ),
    )
    .run().changes;
}
