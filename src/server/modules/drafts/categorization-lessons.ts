import { asc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { CategorizationLesson } from "../../../shared/index.js";
import { accountsTable } from "../../schema/accounts.js";
import {
  categorizationLessons,
  categorizationLessonsTable,
} from "../../schema/categorization-lessons.js";
import type { LedgerAuth } from "../ledger-sql/index.js";

/*
 * The categorization_lessons rows in scope: what the user taught the
 * categoriser about drafts, until their coding agent has encoded it.
 */

const narrationsColumnSchema = z.array(z.string()).min(1);

/** A statement account's lessons, oldest first, with each category's name. */
export function loadCategorizationLessons(
  db: any,
  auth: LedgerAuth,
  baseAccountId: number,
): CategorizationLesson[] {
  return selectLessons(
    db,
    auth,
    eq(categorizationLessonsTable.base_account_id, baseAccountId),
  );
}

/** The lesson `id`, or null when it isn't the caller's. */
export function loadCategorizationLesson(
  db: any,
  auth: LedgerAuth,
  id: number,
): CategorizationLesson | null {
  return (
    selectLessons(db, auth, eq(categorizationLessonsTable.id, id))[0] ?? null
  );
}

function selectLessons(
  db: any,
  auth: LedgerAuth,
  where: SQL,
): CategorizationLesson[] {
  const access = auth.rowSecurity.forTable(categorizationLessons);
  const rows: {
    lesson: typeof categorizationLessonsTable.$inferSelect;
    accountName: string;
  }[] = db
    .select({
      lesson: categorizationLessonsTable,
      accountName: accountsTable.name,
    })
    .from(categorizationLessonsTable)
    .innerJoin(
      accountsTable,
      eq(accountsTable.id, categorizationLessonsTable.account_id),
    )
    .where(access.ownedRows(where))
    .orderBy(asc(categorizationLessonsTable.id))
    .all();
  return rows.map(({ lesson, accountName }) => ({
    id: lesson.id,
    base_account_id: lesson.base_account_id,
    account: { id: lesson.account_id, name: accountName },
    narrations: narrationsColumnSchema.parse(JSON.parse(lesson.narrations)),
    note: lesson.note,
  }));
}

export interface NewCategorizationLesson {
  baseAccountId: number;
  accountId: number;
  narrations: readonly string[];
  note: string;
}

/** Adds a lesson and returns its id. The rules are the caller's to check. */
export function insertCategorizationLesson(
  tx: any,
  auth: LedgerAuth,
  lesson: NewCategorizationLesson,
): number {
  const access = auth.rowSecurity.forTable(categorizationLessons);
  const inserted: { id: number } = tx
    .insert(categorizationLessonsTable)
    .values(
      access.insertValuesSync(tx, {
        base_account_id: lesson.baseAccountId,
        account_id: lesson.accountId,
        narrations: JSON.stringify(lesson.narrations),
        note: lesson.note,
      }),
    )
    .returning({ id: categorizationLessonsTable.id })
    .get();
  return inserted.id;
}

/** Deletes the lesson `id`; how many went, 0 or 1. */
export function deleteCategorizationLesson(
  db: any,
  auth: LedgerAuth,
  id: number,
): number {
  const access = auth.rowSecurity.forTable(categorizationLessons);
  return db
    .delete(categorizationLessonsTable)
    .where(access.ownedRows(eq(categorizationLessonsTable.id, id)))
    .run().changes;
}

/** Deletes a statement account's lessons; how many went. */
export function clearCategorizationLessons(
  db: any,
  auth: LedgerAuth,
  baseAccountId: number,
): number {
  const access = auth.rowSecurity.forTable(categorizationLessons);
  return db
    .delete(categorizationLessonsTable)
    .where(
      access.ownedRows(
        eq(categorizationLessonsTable.base_account_id, baseAccountId),
      ),
    )
    .run().changes;
}
