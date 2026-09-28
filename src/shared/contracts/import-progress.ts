import { z } from "zod";

/*
 * How far a running import has got, for the screen waiting on it: /add's
 * add and /import's batch each take a `progress_id` field and answer a
 * progress query under it while they run.
 */

/**
 * A running import's own name for itself, sent as the `progress_id` field,
 * by which the screen asks how far it has got.
 */
export const importProgressIdSchema = z.string().regex(/^[\w-]{8,64}$/);

/**
 * One statement row of a running import, and its account as far as the
 * import knows: the rules' answer, the coding agent's once it has
 * answered, or none yet. The drafts it saves are the word on it, not this.
 */
export const importProgressRowSchema = z.object({
  date: z.string(),
  narration: z.string(),
  // The money it moves, one way: positive.
  amount: z.number(),
  direction: z.enum(["in", "out"]),
  account: z.string().nullable(),
  // Who answered; null while no one has.
  by: z.enum(["rule", "llm"]).nullable(),
});
export type ImportProgressRow = z.infer<typeof importProgressRowSchema>;

/**
 * How far a running import has got: reading its files (and, for an add,
 * setting up the account), then categorizing (the rules, then the coding
 * agent's answers as they come), then saving the drafts; for a batch of
 * several accounts, one after another. `done` once it has answered: its
 * last word stays readable a little while, so the screen can show the
 * answers it had not yet heard.
 */
export const importProgressSchema = z.object({
  stage: z.enum(["account", "rules", "llm", "saving", "done"]),
  // The rows being imported, account by account in statement order, each
  // with who answered it; empty until the rules run.
  rows: z.array(importProgressRowSchema),
});
export type ImportProgressReport = z.infer<typeof importProgressSchema>;
