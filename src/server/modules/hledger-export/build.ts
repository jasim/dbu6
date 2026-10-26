import { hledgerAccountPaths } from "./account-names.js";
import type {
  ExportAccount,
  ExportEntry,
  ExportJournal,
  HledgerAccountDeclaration,
  HledgerAccountType,
  HledgerBooks,
  HledgerExportInput,
  HledgerJournalFile,
  HledgerPosting,
  HledgerTransaction,
  LedgerAccountType,
  Paise,
  StatementAccount,
} from "./model.js";

const COMMODITY = "1,00,00,000.00";
const GENERAL_FILE = "general-journals.journal";
const ASSERTIONS_FILE = "balance-assertions.journal";
// File names a statement account's file may not take.
const RESERVED_STEMS = new Set([
  "main",
  "general-journals",
  "balance-assertions",
]);

export const TYPE_LETTER: Record<LedgerAccountType, HledgerAccountType> = {
  Asset: "A",
  Liability: "L",
  Equity: "E",
  Revenue: "R",
  Expense: "X",
};
const TYPE_ORDER: readonly HledgerAccountType[] = ["A", "L", "E", "R", "X"];

/**
 * The ledger as hledger's books: every account declared, each journal placed
 * once (in the first statement account's file it touches, else the general
 * file), and each balance assertion where hledger's order still proves it.
 */
export function buildHledgerBooks(input: HledgerExportInput): HledgerBooks {
  const paths = hledgerAccountPaths(input.accounts);
  const slots = statementFileSlots(input.statementAccounts, input.accounts);
  const placed = placeJournals(sortJournals(input.journals), slots);
  const files: HledgerJournalFile[] = [
    ...slots.map((slot, index) => ({
      path: slot.path,
      title: `Transactions of ${slot.name}`,
      transactions: placed[index]!.map((journal) =>
        transactionOf(journal, paths),
      ),
    })),
    {
      path: GENERAL_FILE,
      title: "Transactions that touch none of the statement accounts",
      transactions: placed[slots.length]!.map((journal) =>
        transactionOf(journal, paths),
      ),
    },
  ];
  return {
    commodity: COMMODITY,
    accounts: declareAccounts(input.accounts, paths),
    files: placeAssertions(files, placed, paths),
  };
}

// --- accounts ---

/**
 * Every account, depth-first: roots by type (assets, liabilities, equity,
 * revenue, expenses) and then name, children by name. hledger lists declared
 * siblings in declaration order, so this is the order reports show.
 */
function declareAccounts(
  accounts: readonly ExportAccount[],
  paths: ReadonlyMap<number, string>,
): HledgerAccountDeclaration[] {
  const ids = new Set(accounts.map((account) => account.id));
  const children = new Map<number | null, ExportAccount[]>();
  for (const account of accounts) {
    // An account whose parent is not in scope is listed as a root.
    const parent =
      account.parent_id !== null && ids.has(account.parent_id)
        ? account.parent_id
        : null;
    children.set(parent, [...(children.get(parent) ?? []), account]);
  }
  const byName = (a: ExportAccount, b: ExportAccount) =>
    compareText(paths.get(a.id)!, paths.get(b.id)!) || a.id - b.id;
  const roots = [...(children.get(null) ?? [])].sort(
    (a, b) =>
      TYPE_ORDER.indexOf(TYPE_LETTER[a.account_type]) -
        TYPE_ORDER.indexOf(TYPE_LETTER[b.account_type]) || byName(a, b),
  );

  const declarations: HledgerAccountDeclaration[] = [];
  const visit = (account: ExportAccount) => {
    declarations.push({
      name: paths.get(account.id)!,
      type: TYPE_LETTER[account.account_type],
    });
    for (const child of [...(children.get(account.id) ?? [])].sort(byName)) {
      visit(child);
    }
  };
  roots.forEach(visit);
  return declarations;
}

// --- files ---

type FileSlot = { accountId: number; name: string; path: string };

/**
 * One file per statement account the ledger still has, in the presets'
 * order: a dangling account (deleted from the ledger) and a repeat are
 * skipped. Each is named by a slug of its name, unique among the export's
 * files.
 */
function statementFileSlots(
  statementAccounts: readonly StatementAccount[],
  accounts: readonly ExportAccount[],
): FileSlot[] {
  const ids = new Set(accounts.map((account) => account.id));
  const seen = new Set<number>();
  const stems = new Set<string>();
  const slots: FileSlot[] = [];
  for (const { account_id, name } of statementAccounts) {
    if (!ids.has(account_id) || seen.has(account_id)) continue;
    seen.add(account_id);
    let stem = slug(name) || `account-${account_id}`;
    if (stems.has(stem) || RESERVED_STEMS.has(stem)) {
      stem = `${stem}-${account_id}`;
    }
    stems.add(stem);
    slots.push({ accountId: account_id, name, path: `${stem}.journal` });
  }
  return slots;
}

function slug(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sortJournals(journals: readonly ExportJournal[]): ExportJournal[] {
  return [...journals].sort(
    (a, b) => compareText(a.date, b.date) || a.id - b.id,
  );
}

/**
 * Each journal in exactly one file: the first statement account's file (in
 * include order) that any of its lines touches, else the general file, the
 * last slot. A transfer between two statement accounts is so written once.
 */
function placeJournals(
  journals: readonly ExportJournal[],
  slots: readonly FileSlot[],
): ExportJournal[][] {
  const placed: ExportJournal[][] = [...slots, null].map(() => []);
  for (const journal of journals) {
    const touched = new Set(journal.entries.map((entry) => entry.account_id));
    const index = slots.findIndex((slot) => touched.has(slot.accountId));
    placed[index === -1 ? slots.length : index]!.push(journal);
  }
  return placed;
}

// --- transactions ---

function transactionOf(
  journal: ExportJournal,
  paths: ReadonlyMap<number, string>,
): HledgerTransaction {
  const description = sanitizeDescription(journal.description);
  return {
    date: journal.date,
    description,
    journalId: journal.id,
    postings: sortEntries(journal.entries).map((entry) =>
      postingOf(entry, journal.description, paths),
    ),
  };
}

function sortEntries(entries: readonly ExportEntry[]): ExportEntry[] {
  return [...entries].sort((a, b) => a.id - b.id);
}

function postingOf(
  entry: ExportEntry,
  description: string,
  paths: ReadonlyMap<number, string>,
): HledgerPosting {
  const account = paths.get(entry.account_id);
  if (account === undefined) {
    throw new Error(
      `journal entry ${entry.id} names account ${entry.account_id}, which the export has not`,
    );
  }
  return {
    account,
    amount: toPaise(entry.debit - entry.credit),
    // Placed by `placeAssertions`, which proves each one first.
    assertion: null,
    comment: postingComment(entry, description),
  };
}

function toPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

/**
 * The entry's comment, then its statement narration where it says
 * something the description and comment don't.
 */
function postingComment(
  entry: ExportEntry,
  description: string,
): string | null {
  const comment = entry.comment?.trim() || null;
  const narration = entry.source_narration?.trim() || null;
  const texts = [
    comment !== null && comment !== description.trim() ? comment : null,
    narration !== null &&
    narration !== description.trim() &&
    narration !== comment
      ? narration
      : null,
  ].filter((text): text is string => text !== null);
  return sanitizeComment(texts.join(" / "));
}

/**
 * Text safe after a posting's `;`. A `word:` in a comment is a tag, and
 * `date:` or a `[12-03]` there moves the posting to another day, so `:`
 * becomes the lookalike `∶` and brackets become parentheses.
 */
export function sanitizeComment(text: string): string | null {
  const safe = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\s]/gu, " ")
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/:/g, "∶")
    .replace(/ {2,}/g, " ")
    .trim();
  return safe === "" ? null : safe;
}

/**
 * Text safe after a transaction's `*` status. `;` starts the comment and `|`
 * splits payee from note, so they become `,` and `/`; a leading `(` is read
 * as a code, so it is dropped. The status mark printed before it keeps a
 * leading `*` or `!` from being read as one.
 */
export function sanitizeDescription(text: string): string {
  let safe = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\s]/gu, " ")
    .replace(/;/g, ",")
    .replace(/\|/g, "/")
    .replace(/ {2,}/g, " ")
    .trim();
  while (safe.startsWith("(")) safe = safe.slice(1).trim();
  return safe === "" ? "no description" : safe;
}

// --- balance assertions ---

/**
 * Each recorded assertion where hledger will prove it. hledger checks
 * assertions in date order and, within a day, in parse order: through the
 * includes in order, then down each file. That is not the ledger's order
 * (date, journal id, entry id) once a day's lines sit in two files, as a
 * transfer between two statement accounts does. So hledger's order is
 * simulated in paise, per account, its own lines only:
 *
 * - where the balance at the line matches, the assertion stays on it;
 * - else, where the account's balance at the end of that day matches, it
 *   moves to balance-assertions.journal, included last, so it is checked
 *   after every line of the day;
 * - else the ledger itself disagrees with the statement (a difference dbu6
 *   reports too), and it stays on its line for hledger to report.
 */
function placeAssertions(
  files: readonly HledgerJournalFile[],
  placed: readonly ExportJournal[][],
  paths: ReadonlyMap<number, string>,
): HledgerJournalFile[] {
  type Line = {
    fileIndex: number;
    transactionIndex: number;
    postingIndex: number;
    date: string;
    journalId: number;
    entry: ExportEntry;
  };
  const lines: Line[] = placed.flatMap((journals, fileIndex) =>
    journals.flatMap((journal, transactionIndex) =>
      sortEntries(journal.entries).map((entry, postingIndex) => ({
        fileIndex,
        transactionIndex,
        postingIndex,
        date: journal.date,
        journalId: journal.id,
        entry,
      })),
    ),
  );
  // hledger's order: date, then include order, then position in the file.
  lines.sort(
    (a, b) =>
      compareText(a.date, b.date) ||
      a.fileIndex - b.fileIndex ||
      a.transactionIndex - b.transactionIndex ||
      a.postingIndex - b.postingIndex,
  );

  const running = new Map<number, Paise>();
  const atLine = new Map<Line, Paise>();
  const endOfDay = new Map<string, Paise>();
  for (const line of lines) {
    const accountId = line.entry.account_id;
    const balance =
      (running.get(accountId) ?? 0) +
      toPaise(line.entry.debit - line.entry.credit);
    running.set(accountId, balance);
    atLine.set(line, balance);
    endOfDay.set(dayKey(accountId, line.date), balance);
  }

  const inline = new Map<string, Paise>();
  const moved = new Map<string, HledgerTransaction>();
  for (const line of lines) {
    if (line.entry.assertion === null) continue;
    const asserted = toPaise(line.entry.assertion);
    const key = dayKey(line.entry.account_id, line.date);
    if (atLine.get(line) !== asserted && endOfDay.get(key) === asserted) {
      if (!moved.has(key)) {
        moved.set(key, {
          date: line.date,
          description: "balance assertion",
          journalId: null,
          postings: [
            {
              account: paths.get(line.entry.account_id)!,
              amount: 0,
              assertion: asserted,
              comment: `dbu6 journal ${line.journalId}`,
            },
          ],
        });
      }
      continue;
    }
    inline.set(
      postingKey(line.fileIndex, line.transactionIndex, line.postingIndex),
      asserted,
    );
  }

  const withInline = files.map((file, fileIndex) => ({
    ...file,
    transactions: file.transactions.map((transaction, transactionIndex) => ({
      ...transaction,
      postings: transaction.postings.map((posting, postingIndex) => ({
        ...posting,
        assertion:
          inline.get(postingKey(fileIndex, transactionIndex, postingIndex)) ??
          null,
      })),
    })),
  }));
  if (moved.size === 0) return withInline;
  return [
    ...withInline,
    {
      path: ASSERTIONS_FILE,
      title:
        "Balance assertions checked at the end of their day, after every file's transactions",
      transactions: [...moved.values()].sort(
        (a, b) =>
          compareText(a.date, b.date) ||
          compareText(a.postings[0]!.account, b.postings[0]!.account),
      ),
    },
  ];
}

function dayKey(accountId: number, date: string): string {
  return `${accountId} ${date}`;
}

function postingKey(file: number, transaction: number, posting: number) {
  return `${file} ${transaction} ${posting}`;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
