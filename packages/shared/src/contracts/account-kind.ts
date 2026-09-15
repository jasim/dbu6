import { z } from "zod";

/*
 * Whether the ledger account a statement imports into is a bank account (an
 * asset) or a card (a liability). The kind decides how a balance reads, since
 * a card's ledger balance is negative while money is owed, and that a card's
 * statement must give its closing balance.
 *
 * Import presets, the freeform import request and the import results say it
 * as `is_credit_card`; they convert here. It is a different fact from
 * `StatementAccountKind`, which is what a statement prints about itself.
 */

export const accountKindSchema = z.enum(["bank", "card"]);
export type AccountKind = z.infer<typeof accountKindSchema>;

/** The ledger account type each kind lives under. */
export const LEDGER_ACCOUNT_TYPE = {
  bank: "Asset",
  card: "Liability",
} as const satisfies Record<AccountKind, string>;

/** The kind an `is_credit_card` flag names; an unset flag is a bank account. */
export function accountKindOf(isCreditCard: boolean | undefined): AccountKind {
  return isCreditCard === true ? "card" : "bank";
}

/**
 * The kind of a ledger account read from its type, for an account no preset
 * describes: a Liability is money owed, so a card.
 */
export function accountKindOfType(accountType: string | null): AccountKind {
  return accountType === LEDGER_ACCOUNT_TYPE.card ? "card" : "bank";
}
