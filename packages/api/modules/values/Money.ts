import { z } from "zod";
import { depositMoneySchema, withdrawalMoneySchema } from "dbu6-shared";

// Money moves one way: a positive withdrawal or a positive deposit, never
// both. The wire schemas in dbu6-shared state the rule and every statement
// row is parsed against them; a stored draft's columns become Money through
// `moneyFromColumns`. Direction and amount are read here and nowhere else, so
// a row's transaction key, its journal match, its group and its category all
// agree on which way it moved.
export type Money =
  z.infer<typeof withdrawalMoneySchema> | z.infer<typeof depositMoneySchema>;

export type Direction = "withdrawal" | "deposit";

// Withdrawal and deposit as a table or a match candidate holds them, not yet
// known to move one way.
type MoneyColumns = { withdrawal: number; deposit: number };

export function direction(money: MoneyColumns): Direction {
  return money.deposit > 0 ? "deposit" : "withdrawal";
}

export function amount(money: MoneyColumns): number {
  return direction(money) === "deposit" ? money.deposit : money.withdrawal;
}

export function isWithdrawal(money: MoneyColumns): boolean {
  return direction(money) === "withdrawal";
}

const moneySchema = z.union([withdrawalMoneySchema, depositMoneySchema]);

/** A stored row's columns as Money; throws when they don't move one way. */
export function moneyFromColumns(columns: MoneyColumns): Money {
  const parsed = moneySchema.safeParse({
    withdrawal: columns.withdrawal,
    deposit: columns.deposit,
  });
  if (!parsed.success) {
    throw new Error(
      `A withdrawal of ${columns.withdrawal} and a deposit of ${columns.deposit} must be one positive amount and one zero.`,
    );
  }
  return parsed.data;
}

// Amounts are exact to the paisa, so two that should be the same number and
// differ by less than half a paisa are the same amount: the difference is
// float arithmetic over a sum. Printed balances, asserted balances and the
// running balances that reach them are all compared this way.
export const HALF_PAISA = 0.005;

export function sameAmount(a: number, b: number): boolean {
  return Math.abs(a - b) < HALF_PAISA;
}

/** The amount in paise, which identities and matches compare exactly. */
export function transactionAmountMinor(transaction: {
  withdrawal: number;
  deposit: number;
}): number {
  return Math.round(amount(transaction) * 100);
}
