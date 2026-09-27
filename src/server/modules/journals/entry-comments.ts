import { and, eq, isNull, sql } from "drizzle-orm";
import { Temporal } from "@sapporta/shared/temporal";
import { journalEntriesTable, journalsTable } from "../../schema/journals.js";

/*
 * The comment writer's journal entries. Like its drafts
 * (drafts/draft-comments.ts), these are every user's, unscoped: the writer
 * runs for the machine, and a comment depends on the source narration alone.
 */

const uncommentedWith = (sourceNarration: string) =>
  and(
    isNull(journalEntriesTable.comment),
    eq(journalEntriesTable.source_narration, sourceNarration),
  );

/**
 * The source narrations of entries with no comment yet, each once, oldest
 * first. A manual entry has no source narration and is never here.
 */
export function uncommentedEntryTexts(db: any): string[] {
  return db
    .select({ text: journalEntriesTable.source_narration })
    .from(journalEntriesTable)
    .where(
      and(
        isNull(journalEntriesTable.comment),
        sql`trim(${journalEntriesTable.source_narration}) <> ''`,
      ),
    )
    .groupBy(journalEntriesTable.source_narration)
    .orderBy(sql`min(${journalEntriesTable.id})`)
    .all()
    .map((row: { text: string }) => row.text);
}

/**
 * Gives every entry with `sourceNarration` and no comment `comment`, and
 * returns how many changed. An entry whose comment someone wrote meanwhile
 * keeps it. A journal that is one statement row, as imports post them now,
 * is described by the comment too: one whose only entry with a source
 * narration is among these, and whose description is still that text. An
 * older import's day of rows, described `Expenses` or `Deposits`, keeps its
 * description. Run it inside a transaction, so both change together.
 */
export function writeEntryComment(
  tx: any,
  sourceNarration: string,
  comment: string,
): number {
  const now = Temporal.Now.instant();
  tx.update(journalsTable)
    .set({ description: comment, updated_at: now })
    .where(
      and(
        eq(journalsTable.description, sourceNarration),
        sql`${journalsTable.id} IN (
          SELECT ${journalEntriesTable.journal_id} FROM ${journalEntriesTable}
          WHERE ${uncommentedWith(sourceNarration)}
        )`,
        sql`(
          SELECT count(*) FROM ${journalEntriesTable}
          WHERE ${journalEntriesTable.journal_id} = ${journalsTable.id}
            AND ${journalEntriesTable.source_narration} IS NOT NULL
        ) = 1`,
      ),
    )
    .run();
  return tx
    .update(journalEntriesTable)
    .set({ comment, updated_at: now })
    .where(uncommentedWith(sourceNarration))
    .run().changes;
}
