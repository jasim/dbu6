import type { Abacus } from "../statement/index.js";
import { type Chrono, isWithdrawal } from "../values/index.js";

// A statement row on its way into the books. `account` is its counterparty;
// `assertion` is the base account's balance after this row, which the plan
// asserts when the row closes its day.
export interface PlanRow<A> {
  transaction: Abacus;
  account: A;
  assertion: number | null;
}

// One posting. `account` is whatever the plan's reader needs: an account id
// to write the journal, a name to render it. `amount` is signed, a debit
// positive, as hledger prints it.
export interface PlannedEntry<A> {
  account: A;
  amount: number;
  assertion: number | null;
  comment: string | null;
  sourceReference: string | null;
  sourceTransactionKey: string | null;
}

export interface PlannedJournal<A> {
  date: string;
  description: string;
  entries: PlannedEntry<A>[];
}

export type JournalPlan<A> = PlannedJournal<A>[];

/**
 * The journals a base account's statement rows become: one per row, in order,
 * described by the row's narration, as the statement is. A withdrawal lists
 * the counterparty and then the base account; a deposit lists the base
 * account first. The base account's line asserts the row's `assertion` only
 * when the row closes its day, since within a day the books' order can differ
 * from the statement's (the balance-check rule, in reconciliation). It carries
 * no source identity: the counterparty's line holds that, and the narration
 * too, where matching looks for it.
 */
export function planJournals<A>(
  rows: Chrono<PlanRow<A>>,
  baseAccount: A,
): JournalPlan<A> {
  return rows.map((row, index) => {
    const { transaction } = row;
    const closesDay = rows[index + 1]?.transaction.date !== transaction.date;
    const base = (amount: number): PlannedEntry<A> => ({
      account: baseAccount,
      amount,
      assertion: closesDay ? row.assertion : null,
      comment: null,
      sourceReference: null,
      sourceTransactionKey: null,
    });
    const counterparty = (amount: number): PlannedEntry<A> => ({
      account: row.account,
      amount,
      assertion: null,
      comment: transaction.narration,
      sourceReference: transaction.source_reference ?? null,
      sourceTransactionKey: transaction.source_transaction_key ?? null,
    });
    const entries = isWithdrawal(transaction)
      ? [counterparty(transaction.withdrawal), base(-transaction.withdrawal)]
      : [base(transaction.deposit), counterparty(-transaction.deposit)];
    return {
      date: transaction.date,
      description: transaction.narration,
      entries,
    };
  });
}
