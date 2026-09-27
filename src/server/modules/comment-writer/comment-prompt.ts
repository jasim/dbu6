/**
 * What the comment writer asks of the LLM: a short, readable line for each
 * statement text, extracted from it rather than rewritten. The examples are
 * made up.
 */
export const COMMENT_PROMPT = `\
I keep my accounts from my bank statements. Each input row's "text" is one transaction's description as the bank printed it. For each row, write a short, readable line that I can scan in a list of transactions.

Extract, don't rewrite. Keep only the meaningful words of the text, in the order the text has them:
- Drop reference numbers, transaction ids, UPI ids, the domain of a UPI handle (sample@okaxis → sample), IFSC codes, account and card numbers, dates and times, and the slashes, dashes and codes around them.
- Re-case upper-case text to read naturally: title-case names ("SAMPLE CAFE" → "Sample Cafe"), and leave short forms as they are ("FCY", "IMPS", "IGST", "UPI", "NEFT", "EMI").
- Rejoin a word the statement split across a line break ("MARKU P" → "markup").
- Never expand a short form, reword, translate, or add a word the text doesn't have.
- Text that already reads as prose, as a person wrote it, comes back exactly as it is.
- When nothing meaningful is left, such as a UPI id that is only a phone number, answer an empty string.

Keep the answer under 60 characters.

Examples:
"UPI/050505123456/ SAMPLE CAFE/Q0505051@YBL /YESB0YBLUPI/ 050505000025/UPI/ 050505123456/YESBIFC HO/" → "UPI Sample Cafe"
"IGST-VPS050505123-RATE 18.0 -29 (Ref# VT0505050000001)" → "IGST rate 18.0"
"CONSOLIDATED FCY MARKU P FEE (Ref# VT0505050000002)" → "Consolidated FCY markup fee"
"MB IMPS/IFO/050505123456/SBIN0050505/NOPII NAME" → "MB IMPS Nopii Name"
"sample0505@okaxis" → "sample0505"
"UPI-0505050505@ybl-050505123456" → ""
"groceries with mom" → "groceries with mom"
`;

/** The field each answer row carries its comment in. */
export const COMMENT_OUTPUT_FIELD = "comment";

/** The most texts one call carries. */
export const COMMENTS_PER_CALL = 50;

/** One text as the LLM gets it, by its id. */
export interface CommentRequestRow {
  id: string;
  text: string;
}

/** The texts as rows for one call: each text's id is its index. */
export function commentRequestRows(
  texts: readonly string[],
): CommentRequestRow[] {
  return texts.map((text, index) => ({ id: String(index), text }));
}
