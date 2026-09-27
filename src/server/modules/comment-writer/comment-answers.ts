import { COMMENT_OUTPUT_FIELD } from "./comment-prompt.js";

/** The longest comment the writer keeps, unless it is the text itself. */
export const MAX_COMMENT_LENGTH = 60;

// Six digits in a row are a reference number, an account or a phone number
// the answer should have dropped.
const LEAKED_NUMBER = /\d{6,}/;

/** What one text's answer comes to: the comment to write, or why not. */
export type CommentVerdict =
  { ok: true; comment: string } | { ok: false; reason: string };

/**
 * Checks one answer for `text`. An answer that is the text itself (prose
 * passed through) always passes; an empty one means nothing meaningful was
 * left, and the text is written as its own comment. Anything else passes at
 * most 60 characters and without a run of six digits.
 */
export function checkComment(text: string, answer: unknown): CommentVerdict {
  if (typeof answer !== "string") {
    return { ok: false, reason: "no comment in the answer" };
  }
  const comment = answer.trim();
  if (comment === text.trim()) return { ok: true, comment };
  if (comment === "") return { ok: true, comment: text };
  if (comment.length > MAX_COMMENT_LENGTH) {
    return {
      ok: false,
      reason: `longer than ${MAX_COMMENT_LENGTH} characters`,
    };
  }
  if (LEAKED_NUMBER.test(comment)) {
    return { ok: false, reason: "kept a reference number" };
  }
  return { ok: true, comment };
}

/**
 * Each text's verdict, by its index in `texts`, from the rows one call
 * answered (`commentRequestRows` gave each text its index as its id). A text
 * the call left unanswered fails.
 */
export function commentVerdicts(
  texts: readonly string[],
  answerRows: readonly unknown[],
): CommentVerdict[] {
  const answers = new Map<string, unknown>();
  for (const row of answerRows) {
    if (typeof row !== "object" || row === null) continue;
    const { id, [COMMENT_OUTPUT_FIELD]: comment } = row as Record<
      string,
      unknown
    >;
    if (typeof id === "string" || typeof id === "number") {
      answers.set(String(id), comment);
    }
  }
  return texts.map((text, index) =>
    answers.has(String(index))
      ? checkComment(text, answers.get(String(index)))
      : { ok: false, reason: "not answered" },
  );
}
