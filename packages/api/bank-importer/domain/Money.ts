import { z } from "zod";

export const withdrawalMoneySchema = z.object({
  withdrawal: z.number().positive(),
  deposit: z.literal(0),
});

export const depositMoneySchema = z.object({
  withdrawal: z.literal(0),
  deposit: z.number().positive(),
});

// Express direction as a union instead of a refinement so Nua's generated
// JSON Schema carries the same XOR rule enforced by runtime parsing.
export const moneySchema = z.union([withdrawalMoneySchema, depositMoneySchema]);

// Keep the domain type ergonomic for values assembled from parsed columns.
// Runtime schemas enforce the directional union at system boundaries.
export type Money = {
  withdrawal: number;
  deposit: number;
};

export function isWithdrawal(m: Money): boolean {
  return m.withdrawal > 0;
}

export function isDeposit(m: Money): boolean {
  return m.deposit > 0;
}

export function validateMoney(m: Money): void {
  if (m.withdrawal < 0 || m.deposit < 0) {
    throw new Error("Withdrawal and deposit must be non-negative");
  }
  if (m.withdrawal > 0 && m.deposit > 0) {
    throw new Error("Both withdrawal and deposit are positive");
  }
  if (m.withdrawal <= 0 && m.deposit <= 0) {
    throw new Error("Both withdrawal and deposit are zero or negative");
  }
}
