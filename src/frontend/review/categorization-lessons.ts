// What the user teaches the categoriser from Review's Improve categorization
// tab: drafts they picked and the account those drafts go to, with a note
// for next time. Lessons wait in a list, kept in this browser per account,
// until the user hands them to their coding agent, which decides how each is
// encoded: a rule in transaction_mappings.mjs, a line of guidance, or both.

import { useCallback, useState } from "react";
import { z } from "zod";
import { guideCommand, type ReviewAccountDetail } from "../../shared/index";
import { PII_RULE } from "../agent-prompt-rules";
import { agree, plural } from "../format";
import { reviewHref } from "./routes";

const lessonSchema = z.object({
  narrations: z.array(z.string()).min(1),
  account: z.object({ id: z.number(), name: z.string() }),
  // What the user added for next time, or "".
  note: z.string(),
});
export type CategorizationLesson = z.infer<typeof lessonSchema>;

/** Narrations listed under a lesson before the rest are only counted. */
export const LESSON_NARRATION_LIMIT = 20;

function storageKey(accountId: number): string {
  return `dbu6.categorization-lessons.${accountId}`;
}

// The browser may refuse storage (a private window, blocked site data); the
// list then lasts as long as the page.
function readLessons(accountId: number): CategorizationLesson[] {
  try {
    const stored = window.localStorage.getItem(storageKey(accountId));
    if (stored === null) return [];
    const parsed = z.array(lessonSchema).safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function writeLessons(
  accountId: number,
  lessons: readonly CategorizationLesson[],
): void {
  try {
    if (lessons.length === 0) {
      window.localStorage.removeItem(storageKey(accountId));
    } else {
      window.localStorage.setItem(storageKey(accountId), JSON.stringify(lessons));
    }
  } catch {
    // Kept in the page only.
  }
}

/** The account's list of lessons, kept across reloads. */
export function useCategorizationLessons(accountId: number) {
  const [lessons, setLessons] = useState(() => readLessons(accountId));
  const change = useCallback(
    (next: (current: CategorizationLesson[]) => CategorizationLesson[]) =>
      setLessons((current) => {
        const changed = next(current);
        writeLessons(accountId, changed);
        return changed;
      }),
    [accountId],
  );
  return {
    lessons,
    add: (lesson: CategorizationLesson) =>
      change((current) => [...current, lesson]),
    remove: (index: number) =>
      change((current) => current.filter((_, at) => at !== index)),
    clear: () => change(() => []),
  };
}

/**
 * The request to the coding agent: each lesson as the user gave it. How a
 * lesson is encoded is the agent's to decide, by the books guide.
 */
export function lessonsPrompt(
  detail: ReviewAccountDetail,
  lessons: readonly CategorizationLesson[],
): string {
  const { account } = detail;
  const books = guideCommand("books");
  return `I'm teaching my books app (this repository) how to categorise my bank
transactions, on the screen ${reviewHref(account.account_id, "improve-categorization")}.
These are drafts imported for ${account.name} (ledger account ${account.path},
account id ${account.account_id}), and where I've said they go:

${lessons.map(lessonText).join("\n\n")}

For each numbered lesson, decide how to encode it so that future imports
categorise transactions like these on their own: as a rule in
user-config/transaction_mappings.mjs, as guidance in one of the instruction
files this account's import preset lists, or both. \`${books}\` says how to
choose, under "Always put this under X — adding a mapping", and how to read
this account's import preset. A rule applies to every account; an instruction
file applies to every account whose preset lists it. If this account lists no
instruction file, or only an empty one, tell me, and propose which to use.

I have already given these drafts their categories, so leave them as they are.
Once the rules and guidance are in place, run the categoriser again on this
account's drafts that still have no category, as the same guide describes
under "Categorise these".

${PII_RULE}

Report back what you did for each numbered lesson and why, and how many of the
remaining drafts the categoriser then categorised.`;
}

function lessonText(lesson: CategorizationLesson, index: number): string {
  const shown = lesson.narrations.slice(0, LESSON_NARRATION_LIMIT);
  const rest = lesson.narrations.length - shown.length;
  return [
    `${index + 1}. ${plural(lesson.narrations.length, "draft")} ${agree(lesson.narrations.length, "goes", "go")} to "${lesson.account.name}":`,
    ...shown.map((narration) => `   - ${narration}`),
    ...(rest > 0 ? [`   - and ${rest} more like these`] : []),
    ...(lesson.note === "" ? [] : [`   My note: ${lesson.note}`]),
  ].join("\n");
}
