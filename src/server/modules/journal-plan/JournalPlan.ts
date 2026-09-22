import { groupByDateAndType } from "./TransactionGroup.js";
import type { Abacus } from "../statement/index.js";
import type { Chrono } from "../values/index.js";

// A statement row on its way into the books. `account` is its counterparty;
// `assertion` is the base account's balance after this row, which the plan
// asserts when the row closes its group.
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
 * The journals a base account's statement rows become, in order: one per run
 * of same-date, same-direction rows. A withdrawal run lists each counterparty
 * and then the base account's total; a deposit run lists the base account's
 * total first. The base account's line asserts the run's last row's
 * `assertion`, and carries no source identity, since it sums several rows.
 */
export function planJournals<A>(
  rows: Chrono<PlanRow<A>>,
  baseAccount: A,
): JournalPlan<A> {
  return groupByDateAndType(rows).map((group) => {
    const last = group.transactions[group.transactions.length - 1];
    const base = (amount: number): PlannedEntry<A> => ({
      account: baseAccount,
      amount,
      assertion: last.assertion,
      comment: null,
      sourceReference: null,
      sourceTransactionKey: null,
    });
    const counterparty = (
      row: PlanRow<A>,
      amount: number,
    ): PlannedEntry<A> => ({
      account: row.account,
      amount,
      assertion: null,
      comment: row.transaction.narration,
      sourceReference: row.transaction.source_reference ?? null,
      sourceTransactionKey: row.transaction.source_transaction_key ?? null,
    });

    if (group.type === "withdrawal") {
      let total = 0;
      const entries = group.transactions.map((row) => {
        total += row.transaction.withdrawal;
        return counterparty(row, row.transaction.withdrawal);
      });
      return {
        date: group.date,
        description: "Expenses",
        entries: [...entries, base(-total)],
      };
    }
    const total = group.transactions.reduce(
      (sum, row) => sum + row.transaction.deposit,
      0,
    );
    return {
      date: group.date,
      description: "Deposits",
      entries: [
        base(total),
        ...group.transactions.map((row) =>
          counterparty(row, -row.transaction.deposit),
        ),
      ],
    };
  });
}
