import type { TransactionGroup } from "./TransactionGroup.js";
import type { Account } from "./Account.js";

export interface HledgerJournal {
  entries: string[];
}

/**
 * Convert transaction groups into formatted hledger journal entry strings.
 *
 * For withdrawals:
 *   {date} Expenses
 *       {expense_account:<35} {amount:>10.2f} ; {narration}
 *       {base_account:<35} {-total:>10.2f} = {balance:.2f}
 *
 * For deposits:
 *   {date} Deposits
 *       {base_account:<35} {total:>10.2f} = {balance:.2f}
 *       {income_account:<35} {-amount:>10.2f} ; {narration}
 */
export function fromGroups(
  groups: TransactionGroup[],
  baseAccount: Account,
): HledgerJournal {
  const entries: string[] = [];

  for (const group of groups) {
    if (group.transactions.length === 0) continue;

    const dateStr = group.date;
    const description = group.type === "deposit" ? "Deposits" : "Expenses";
    const lines: string[] = [`${dateStr} ${description}`];

    const balance = group.endOfGroupBalance;
    const balanceSuffix = balance !== null ? ` = ${balance.toFixed(2)}` : "";

    if (group.type === "withdrawal") {
      let total = 0;
      for (const ct of group.transactions) {
        const amount = ct.transaction.withdrawal;
        const narration = ct.transaction.narration;
        lines.push(
          `    ${ct.account.padEnd(35)} ${amount.toFixed(2).padStart(10)} ; ${narration}`,
        );
        total += amount;
      }
      lines.push(
        `    ${baseAccount.padEnd(35)} ${(-total).toFixed(2).padStart(10)}${balanceSuffix}`,
      );
    } else {
      // Deposits: bank account first, then income accounts
      let total = 0;
      for (const ct of group.transactions) {
        total += ct.transaction.deposit;
      }
      lines.push(
        `    ${baseAccount.padEnd(35)} ${total.toFixed(2).padStart(10)}${balanceSuffix}`,
      );
      for (const ct of group.transactions) {
        const amount = ct.transaction.deposit;
        const narration = ct.transaction.narration;
        lines.push(
          `    ${ct.account.padEnd(35)} ${(-amount).toFixed(2).padStart(10)} ; ${narration}`,
        );
      }
    }

    entries.push(lines.join("\n"));
  }

  return { entries };
}

export function format(journal: HledgerJournal): string {
  return journal.entries.join("\n\n");
}
