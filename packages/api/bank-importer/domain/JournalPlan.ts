import type { TransactionGroup } from "./TransactionGroup.js";
import type { CategorizedDraft } from "./DraftCategorizedTransaction.js";

export interface JournalEntryRow {
  account_id: number;
  debit: string;
  credit: string;
  account_balance_assertion: string | null;
  comment: string | null;
  source_reference: string | null;
  source_transaction_key: string | null;
}

export interface JournalInsert {
  date: string;
  description: string;
  entries: JournalEntryRow[];
}

export type JournalPlan = JournalInsert[];

/**
 * Build an ordered plan of journal inserts from transaction groups.
 *
 * The shape mirrors HledgerJournal.fromGroups: same grouping, same
 * base-account ordering (counterparty lines first for withdrawals, base
 * account first for deposits), same balance-assertion placement — only the
 * output is row data instead of formatted text.
 */
export function fromGroups(
  groups: TransactionGroup<CategorizedDraft>[],
  baseAccountId: number,
): JournalPlan {
  const plan: JournalInsert[] = [];

  for (const group of groups) {
    if (group.transactions.length === 0) continue;

    const description = group.type === "deposit" ? "Deposits" : "Expenses";
    const balanceAssertion =
      group.endOfGroupBalance === null
        ? null
        : group.endOfGroupBalance.toFixed(2);

    const baseRow = (debit: string, credit: string): JournalEntryRow => ({
      account_id: baseAccountId,
      debit,
      credit,
      account_balance_assertion: balanceAssertion,
      comment: null,
      source_reference: null,
      source_transaction_key: null,
    });

    const counterpartyRow = (
      m: CategorizedDraft,
      debit: string,
      credit: string,
    ): JournalEntryRow => ({
      account_id: m.accountId,
      debit,
      credit,
      account_balance_assertion: null,
      comment: m.transaction.narration,
      source_reference: m.transaction.source_reference ?? null,
      source_transaction_key: m.transaction.source_transaction_key ?? null,
    });

    const entries: JournalEntryRow[] = [];

    if (group.type === "withdrawal") {
      let total = 0;
      for (const m of group.transactions) {
        entries.push(
          counterpartyRow(m, m.transaction.withdrawal.toFixed(2), "0"),
        );
        total += m.transaction.withdrawal;
      }
      entries.push(baseRow("0", total.toFixed(2)));
    } else {
      const total = group.transactions.reduce(
        (s, m) => s + m.transaction.deposit,
        0,
      );
      entries.push(baseRow(total.toFixed(2), "0"));
      for (const m of group.transactions) {
        entries.push(counterpartyRow(m, "0", m.transaction.deposit.toFixed(2)));
      }
    }

    plan.push({ date: group.date, description, entries });
  }

  return plan;
}
