// The comment writer's pure part: what it asks the LLM for a statement text's
// comment, and which answers it keeps. The workflow
// (workflows/comment-writer.ts) finds the texts, calls the LLM and writes.
export {
  COMMENT_OUTPUT_FIELD,
  COMMENT_PROMPT,
  COMMENTS_PER_CALL,
  commentRequestRows,
  type CommentRequestRow,
} from "./comment-prompt.js";
export {
  checkComment,
  commentVerdicts,
  MAX_COMMENT_LENGTH,
  type CommentVerdict,
} from "./comment-answers.js";
