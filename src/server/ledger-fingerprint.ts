/**
 * The ledger fingerprint: the figures of a person's books that no schema
 * migration may change. `migrateSafely` takes it before and after every
 * migration, and dbu6 keeps no backup, so this module is the whole safety net.
 *
 * A fingerprint is a flat map from a figure's name to its value, so two of
 * them are compared figure by figure and a difference can be named.
 *
 *   account.parent:<id>          the account's parent id, or "none"
 *   account.balance:<id>         posted debits less credits
 *   account.draft-balance:<id>   draft deposits less withdrawals where the
 *                                account is the base, and the reverse where it
 *                                is the category
 *   journals.count  entries.count  drafts.count
 *   entries.hash    every entry's id, journal, account, date, debit, credit
 *   drafts.hash     every draft's id, date, withdrawal, deposit, category
 *                   account, base account
 *   journals.unbalanced          ids of journals whose debits and credits
 *                                differ, or "none"
 *   trial-balance                all debits less all credits
 *
 * Books that are already out of balance stay upgradable: the last two are
 * compared like the others, not required to be clean.
 *
 * ## When a migration alters a table read here
 *
 * The figures are computed from rows that a `LedgerReader` selects. A migration
 * that renames or reshapes a column those queries name must, in the same
 * commit, move today's reader into `READERS_BEFORE` under its own tag and
 * write the new one as `readCurrentLedger`. `ledgerFingerprint` picks the
 * reader by the database's last applied migration, so the fingerprint of the
 * schema before and the schema after are both readable, and equal.
 *
 * ## When a migration means to change a figure
 *
 * It says so in `FIGURES_A_MIGRATION_CHANGES`, by kind. Only those kinds are
 * left out of the comparison across that one migration.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { pendingMigrations } from "@sapporta/server";
import { dbu6MigrationsDir } from "./runtime.js";

export type FigureKind =
  | "account.parent"
  | "account.balance"
  | "account.draft-balance"
  | "journals.count"
  | "entries.count"
  | "entries.hash"
  | "journals.unbalanced"
  | "trial-balance"
  | "drafts.count"
  | "drafts.hash";

/** A figure's name (`<kind>` or `<kind>:<account id>`) to its value. */
export type LedgerFingerprint = Readonly<Record<string, string>>;

/**
 * Figures a migration is meant to change, by the migration's tag. An entry
 * here is a statement in review: "this migration rewrites these figures, and
 * nothing else about the books". No migration has needed one yet.
 */
export const FIGURES_A_MIGRATION_CHANGES: Readonly<
  Record<string, readonly FigureKind[]>
> = {};

// --- Rows, per schema version -------------------------------------------

interface LedgerRows {
  accounts: { id: number; parent_id: number | null }[];
  journalCount: number;
  /** Ordered by id. `date` is the journal's. */
  entries: {
    id: number;
    journal_id: number;
    account_id: number;
    date: string;
    debit: number;
    credit: number;
  }[];
  /** Ordered by id. */
  drafts: {
    id: number;
    date: string;
    withdrawal: number;
    deposit: number;
    account_id: number | null;
    base_account_id: number | null;
  }[];
}

type LedgerReader = (sqlite: Database.Database) => LedgerRows;

const readCurrentLedger: LedgerReader = (sqlite) => ({
  accounts: sqlite
    .prepare("SELECT id, parent_id FROM accounts ORDER BY id")
    .all() as LedgerRows["accounts"],
  journalCount: (
    sqlite.prepare("SELECT COUNT(*) AS n FROM journals").get() as { n: number }
  ).n,
  // LEFT JOIN: an entry whose journal is gone is still an entry, and must
  // still be one afterwards.
  entries: sqlite
    .prepare(
      `SELECT e.id, e.journal_id, e.account_id, COALESCE(j.date, '') AS date,
              e.debit, e.credit
       FROM journal_entries e LEFT JOIN journals j ON j.id = e.journal_id
       ORDER BY e.id`,
    )
    .all() as LedgerRows["entries"],
  drafts: sqlite
    .prepare(
      `SELECT id, date, withdrawal, deposit, account_id, base_account_id
       FROM draft_transactions ORDER BY id`,
    )
    .all() as LedgerRows["drafts"],
});

/** Before the ledger's tables exist there are no books. */
const readNoLedger: LedgerReader = () => ({
  accounts: [],
  journalCount: 0,
  entries: [],
  drafts: [],
});

/**
 * Readers for older schemas, oldest first: `reader` reads a database whose
 * last applied migration comes before `migration`.
 */
const READERS_BEFORE: readonly { migration: string; reader: LedgerReader }[] = [
  { migration: "0001_organic_menace", reader: readNoLedger },
];

// --- The fingerprint ----------------------------------------------------

/**
 * The fingerprint of the books in `sqlite`, read with the reader for the
 * database's last applied migration. `migrationsDir` is ours unless a test
 * names another.
 */
export function ledgerFingerprint(
  sqlite: Database.Database,
  migrationsDir: string = dbu6MigrationsDir(),
): LedgerFingerprint {
  const rows = readerFor(sqlite, migrationsDir)(sqlite);
  const figures: Record<string, string> = {};

  // Sums are taken here, in id order, rather than by SQL's SUM: float addition
  // depends on order, and a migration that rebuilds a table may change the
  // order SQLite visits rows in without changing a single value.
  const balance = new Map<number, number>();
  const draftBalance = new Map<number, number>();
  const journalNet = new Map<number, number>();
  const add = (map: Map<number, number>, key: number, amount: number) =>
    map.set(key, (map.get(key) ?? 0) + amount);

  const entriesHash = createHash("sha256");
  let trialBalance = 0;
  for (const e of rows.entries) {
    entriesHash.update(
      `${e.id}|${e.journal_id}|${e.account_id}|${e.date}|${e.debit}|${e.credit}\n`,
    );
    add(balance, e.account_id, e.debit - e.credit);
    add(journalNet, e.journal_id, e.debit - e.credit);
    trialBalance += e.debit - e.credit;
  }

  const draftsHash = createHash("sha256");
  for (const d of rows.drafts) {
    draftsHash.update(
      `${d.id}|${d.date}|${d.withdrawal}|${d.deposit}|${d.account_id}|${d.base_account_id}\n`,
    );
    if (d.base_account_id !== null) {
      add(draftBalance, d.base_account_id, d.deposit - d.withdrawal);
    }
    if (d.account_id !== null) {
      add(draftBalance, d.account_id, d.withdrawal - d.deposit);
    }
  }

  // Every account, and every id an entry or a draft names even if no account
  // row carries it, so a migration that drops an account cannot hide it.
  const accountIds = new Set([
    ...rows.accounts.map((a) => a.id),
    ...balance.keys(),
    ...draftBalance.keys(),
  ]);
  const parents = new Map(rows.accounts.map((a) => [a.id, a.parent_id]));
  for (const id of accountIds) {
    figures[`account.parent:${id}`] = parents.has(id)
      ? String(parents.get(id) ?? "none")
      : "no such account";
    figures[`account.balance:${id}`] = money(balance.get(id) ?? 0);
    figures[`account.draft-balance:${id}`] = money(draftBalance.get(id) ?? 0);
  }

  figures["journals.count"] = String(rows.journalCount);
  figures["entries.count"] = String(rows.entries.length);
  figures["entries.hash"] = entriesHash.digest("hex");
  figures["drafts.count"] = String(rows.drafts.length);
  figures["drafts.hash"] = draftsHash.digest("hex");
  figures["journals.unbalanced"] =
    [...journalNet]
      .filter(([, net]) => money(net) !== money(0))
      .map(([id]) => id)
      .join(",") || "none";
  figures["trial-balance"] = money(trialBalance);
  return figures;
}

/**
 * A sum as text. The hashes hold every amount exactly; a sum is rounded to
 * four places so float noise in the last bits never reads as a difference
 * (and -0 prints as 0).
 */
function money(amount: number): string {
  const rounded = Math.round(amount * 10_000) / 10_000;
  return (rounded === 0 ? 0 : rounded).toFixed(4);
}

/**
 * The figures that differ between two fingerprints, one line each, leaving
 * out the kinds in `skipped`: what the migration between them declares in
 * `FIGURES_A_MIGRATION_CHANGES`.
 */
export function fingerprintDifferences(
  before: LedgerFingerprint,
  after: LedgerFingerprint,
  skipped: readonly FigureKind[] = [],
): string[] {
  const skip = new Set<string>(skipped);
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return names
    .filter((name) => !skip.has(name.split(":")[0]!))
    .filter((name) => before[name] !== after[name])
    .sort()
    .map(
      (name) =>
        `${name}: ${before[name] ?? "(absent)"} -> ${after[name] ?? "(absent)"}`,
    );
}

// --- Choosing the reader ------------------------------------------------

function readerFor(
  sqlite: Database.Database,
  migrationsDir: string,
): LedgerReader {
  const tags = journalTags(migrationsDir);
  const pending = new Set(
    pendingMigrations(sqlite, migrationsDir).map((m) => m.tag),
  );
  // -1: nothing applied yet.
  const lastApplied = tags.reduce(
    (last, tag, index) => (pending.has(tag) ? last : index),
    -1,
  );
  for (const { migration, reader } of READERS_BEFORE) {
    const index = tags.indexOf(migration);
    // A reader for a migration this directory does not hold says nothing
    // about this database.
    if (index !== -1 && lastApplied < index) return reader;
  }
  return readCurrentLedger;
}

/** The journal's migration tags, in the order they apply. */
export function journalTags(migrationsDir: string): string[] {
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((e) => e.tag);
}
