import { z } from "zod";

/*
 * The first and last dates of some rows: a statement's transactions, or an
 * account's drafts. Both dates exist or neither does, so a contract carries
 * the span whole and says null for the span.
 */

export const dateSpanSchema = z.object({
  first_date: z.string(),
  last_date: z.string(),
});
export type DateSpan = z.infer<typeof dateSpanSchema>;
