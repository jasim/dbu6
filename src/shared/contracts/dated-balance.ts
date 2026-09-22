import { z } from "zod";

/*
 * A balance on a day: the ledger's last reconciled balance for an account, or
 * the last balance its drafts carry from a statement. The date and the figure
 * mean something only together, so a contract carries the pair whole and says
 * null for the pair, never for one half.
 */

export const datedBalanceSchema = z.object({
  date: z.string(),
  balance: z.number(),
});
export type DatedBalance = z.infer<typeof datedBalanceSchema>;
