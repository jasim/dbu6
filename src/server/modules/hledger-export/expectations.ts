import { hledgerAccountPaths } from "./account-names.js";
import { sanitizeDescription, TYPE_LETTER } from "./build.js";
import type {
  ExpectedAccount,
  ExpectedAssertion,
  ExpectedBalanceSheet,
  ExpectedTransaction,
  ExportJournal,
  HledgerExpectations,
  HledgerExportInput,
} from "./model.js";
import { formatPaise } from "./render.js";

/**
 * What hledger should find in the export, for verify.py to check: worked
 * out from the ledger's rows on their own, not from the placed and rendered
 * books, so a fault in placing or printing shows. Only the account paths and
 * the description's sanitizing are shared, since they are how hledger names
 * what dbu6 has. `random` picks the sample, a different set each export.
 */
export function buildHledgerExpectations({
  input,
  balanceSheet,
  generatedAt,
  random,
  sampleSize = 25,
}: {
  input: HledgerExportInput;
  balanceSheet: ExpectedBalanceSheet;
  generatedAt: string;
  random: () => number;
  sampleSize?: number;
}): HledgerExpectations {
  const paths = hledgerAccountPaths(input.accounts);
  const pathOf = (accountId: number): string => {
    const path = paths.get(accountId);
    if (path === undefined) {
      throw new Error(`account ${accountId} is not in the export`);
    }
    return path;
  };
  const journals = [...input.journals].sort(byDateThenId);

  return {
    version: 1,
    generated_at: generatedAt,
    last_date: journals.at(-1)?.date ?? null,
    journal_count: journals.length,
    accounts: accountBalances(input, pathOf),
    balance_sheet: balanceSheet,
    assertions: journals.flatMap((journal) =>
      byId(journal.entries)
        .filter((entry) => entry.assertion !== null)
        .map((entry): ExpectedAssertion => ({
          dbu6_id: journal.id,
          date: journal.date,
          account: pathOf(entry.account_id),
          balance: formatPaise(toPaise(entry.assertion!)),
        })),
    ),
    sample_transactions: sample(journals, sampleSize, random)
      .sort(byDateThenId)
      .map((journal): ExpectedTransaction => ({
        dbu6_id: journal.id,
        date: journal.date,
        description: sanitizeDescription(journal.description),
        postings: byId(journal.entries).map((entry) => ({
          account: pathOf(entry.account_id),
          amount: formatPaise(toPaise(entry.debit - entry.credit)),
        })),
      })),
  };
}

/**
 * Each account with entries, its own entries' sum (subaccounts excluded),
 * by path. Summed in paise, line by line, as hledger sums the printed
 * amounts.
 */
function accountBalances(
  input: HledgerExportInput,
  pathOf: (accountId: number) => string,
): ExpectedAccount[] {
  const sums = new Map<number, number>();
  for (const journal of input.journals) {
    for (const entry of journal.entries) {
      sums.set(
        entry.account_id,
        (sums.get(entry.account_id) ?? 0) + toPaise(entry.debit - entry.credit),
      );
    }
  }
  const types = new Map(
    input.accounts.map((account) => [account.id, account.account_type]),
  );
  return [...sums]
    .map(([accountId, paise]) => ({
      account: pathOf(accountId),
      type: TYPE_LETTER[types.get(accountId)!],
      balance: formatPaise(paise),
    }))
    .sort((a, b) =>
      a.account < b.account ? -1 : a.account > b.account ? 1 : 0,
    );
}

/** `count` distinct journals, by a partial Fisher–Yates shuffle. */
function sample(
  journals: readonly ExportJournal[],
  count: number,
  random: () => number,
): ExportJournal[] {
  const pool = [...journals];
  const take = Math.min(count, pool.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, take);
}

function byDateThenId(a: ExportJournal, b: ExportJournal): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id;
}

function byId<T extends { id: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.id - b.id);
}

function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}
