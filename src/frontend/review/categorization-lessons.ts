// The new rules the user makes on Review's Improve categorization tab: drafts
// they picked and the account those drafts go to, with a note for next time.
// They wait in the books as lessons (categorization_lessons) until the user
// hands them to their coding agent, which decides how each is encoded, a rule
// in transaction_mappings.mjs, a line of guidance, or both, and then deletes
// it from the list. The drafts get their category when the user next runs
// the categorizer.

import {
  guideCommand,
  type CategorizationLesson,
  type ReviewAccountDetail,
} from "../../shared/index";
import { PII_RULE } from "../agent-prompt-rules";
import { agree, plural } from "../format";
import { reviewHref } from "./routes";

/** Narrations listed under a lesson before the rest are only counted. */
export const LESSON_NARRATION_LIMIT = 20;

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
  return `I'm adding categorization rules to my books app (this repository), on the
screen ${reviewHref(account.account_id, "improve-categorization")}. These are
drafts imported for ${account.name} (ledger account ${account.path}, account
id ${account.account_id}), and where I've said they go:

${lessons.map(lessonText).join("\n\n")}

For each numbered lesson, decide how to encode it so that future imports
categorise transactions like these on their own: as a rule in
user-config/transaction_mappings.mjs, as guidance in one of the instruction
files this account's import preset lists, or both. \`${books}\` says how to
choose, under "Always put this under X — adding a mapping", and how to read
this account's import preset. A rule applies to every account; an instruction
file applies to every account whose preset lists it. If this account lists no
instruction file, or only an empty one, tell me, and propose which to use.

Don't categorise the drafts yourself: once the rules are in, I run the
categoriser from the app.

When a lesson is encoded, delete it from my list with
\`sapporta api delete /api/categorization-lessons/<lesson id>\`. Leave any
lesson you could not encode on the list.

${PII_RULE}

Report back what you did for each numbered lesson and why.`;
}

function lessonText(lesson: CategorizationLesson, index: number): string {
  const shown = lesson.narrations.slice(0, LESSON_NARRATION_LIMIT);
  const rest = lesson.narrations.length - shown.length;
  return [
    `${index + 1}. ${plural(lesson.narrations.length, "draft")} ${agree(lesson.narrations.length, "goes", "go")} to "${lesson.account.name}" (lesson id ${lesson.id}):`,
    ...shown.map((narration) => `   - ${narration}`),
    ...(rest > 0 ? [`   - and ${rest} more like these`] : []),
    ...(lesson.note === "" ? [] : [`   My note: ${lesson.note}`]),
  ].join("\n");
}
