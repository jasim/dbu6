import { z } from "zod";

export const withdrawalMoneySchema = z.object({
  withdrawal: z.number().positive(),
  deposit: z.literal(0),
});

export const depositMoneySchema = z.object({
  withdrawal: z.literal(0),
  deposit: z.number().positive(),
});

// Keep the domain type ergonomic for values assembled from parsed columns.
// Runtime schemas enforce the directional union at system boundaries.
export type Money = {
  withdrawal: number;
  deposit: number;
};

export function isWithdrawal(m: Money): boolean {
  return m.withdrawal > 0;
}
