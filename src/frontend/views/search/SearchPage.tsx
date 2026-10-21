import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@sapporta/frontend/shell";
import {
  SEARCH_LIMIT,
  type SearchAccount,
  type SearchDraft,
  type SearchJournal,
} from "../../../shared/index";
import { AccountName } from "../../components/account-name";
import { formatDate, formatMoney } from "../../format";
import { searchQuery } from "../../queries";
import { accountLedgerHref, journalHref } from "../../reports/links";
import { reviewHref } from "../../review/routes";

/*
 * One search over the whole books: posted transactions, the drafts waiting
 * in Review, and accounts. A result matches every word of the search, each
 * anywhere in it: its description, comment, the bank's text or reference,
 * an account, or an amount.
 */

const INPUT =
  "block h-sap-ctl w-full rounded-control border border-sap-border-strong bg-card px-3 text-row text-foreground placeholder:text-ink-meta";

export function SearchPage() {
  usePageTitle("Search");
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [draft, setDraft] = useState(q);
  // The sidebar's field, or Back, changes q under the page.
  useEffect(() => setDraft(q), [q]);

  const search = (value: string) =>
    setParams(value.trim() === "" ? {} : { q: value.trim() });
  const query = useQuery(searchQuery(q));
  const results = q.trim() === "" ? undefined : query.data;

  return (
    <div className="flex-1 overflow-y-auto bg-sap-surface">
      <div className="mx-auto max-w-[1080px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="max-w-[720px] border-b border-sap-border pb-4">
          <h1 className="text-title text-foreground sm:text-display">Search</h1>
          <form
            role="search"
            className="mt-3"
            onSubmit={(event) => {
              event.preventDefault();
              search(draft);
            }}
          >
            <input
              type="search"
              name="q"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Words, a reference, an account or an amount"
              aria-label="Search the books"
              autoFocus
              className={INPUT}
            />
          </form>
        </header>

        <main className="space-y-8 py-5">
          {q.trim() === "" ? (
            <p className="text-row text-ink-meta">
              Every word must match. Put a phrase in "quotes".
            </p>
          ) : query.isError ? (
            <p className="text-row text-destructive">
              The search didn't run. Try again.
            </p>
          ) : !results ? (
            <p className="text-row text-ink-meta">Searching…</p>
          ) : results.journals.length +
              results.drafts.length +
              results.accounts.length ===
            0 ? (
            <p className="text-row text-ink-meta">Nothing matches “{q}”.</p>
          ) : (
            <>
              <AccountResults
                rows={results.accounts}
                words={results.words}
                truncated={results.truncated.accounts}
              />
              <JournalResults
                rows={results.journals}
                words={results.words}
                truncated={results.truncated.journals}
              />
              <DraftResults
                rows={results.drafts}
                words={results.words}
                q={q}
                truncated={results.truncated.drafts}
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  truncated,
  columns,
  children,
}: {
  title: string;
  count: number;
  truncated: boolean;
  columns?: ReactNode;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="@container">
      <h2 className="text-heading text-foreground">
        {title}{" "}
        <span className="text-row font-normal text-ink-meta">
          {truncated ? `first ${SEARCH_LIMIT}` : count}
        </span>
      </h2>
      <div className="mt-2">{columns}</div>
      <ul className="divide-y divide-sap-border border-y border-sap-border">
        {children}
      </ul>
    </section>
  );
}

/**
 * A transaction as a result line shows it: what it was, where the money went
 * and how much. For an older journal grouping a day's statement rows, the
 * line is the row that matched, not the day.
 */
interface Hit {
  key: string;
  href: string | null;
  date: string;
  title: string;
  flow: Flow;
  amount: number;
  // The journal a matched row is part of, when it moved more than the row.
  partOf: { description: string; amount: number } | null;
}

/** Where money went: the accounts it left, and the accounts it reached. */
interface Flow {
  from: readonly string[];
  to: readonly string[];
}

// When its list is wide enough (56rem), a result is a table row: date, what, from, to, amount. On a
// phone the date leads its own line, and from → to follows the description.
const TX_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-2 @4xl:grid-cols-[6.5rem_minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)_7.5rem]";

/** The transaction table's column names, when the list is wide enough. */
function TransactionColumns() {
  return (
    <div
      aria-hidden="true"
      className={`${TX_GRID} hidden pb-2 text-label uppercase tracking-wide text-ink-soft @4xl:grid`}
    >
      <span>Date</span>
      <span>Description</span>
      <span>From</span>
      <span>To</span>
      <span className="text-right">Amount</span>
    </div>
  );
}

function RowLink({
  href,
  className,
  children,
}: {
  href: string | null;
  className: string;
  children: ReactNode;
}) {
  return (
    <li>
      {href ? (
        <Link
          to={href}
          className={`${className} text-foreground no-underline hover:bg-sap-nav-hover`}
        >
          {children}
        </Link>
      ) : (
        <div className={className}>{children}</div>
      )}
    </li>
  );
}

function HitRow({ hit, words }: { hit: Hit; words: readonly string[] }) {
  return (
    <RowLink href={hit.href} className={`${TX_GRID} py-3`}>
      <span className="col-span-2 text-[15px] tabular-nums text-ink-soft @4xl:col-span-1">
        {formatDate(hit.date)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[16px] font-medium">
          <Marked text={hit.title} words={words} />
        </span>
        {hit.partOf !== null && (
          <span className="mt-0.5 block truncate text-[14px] text-ink-soft">
            Part of {hit.partOf.description}, {formatMoney(hit.partOf.amount)}
          </span>
        )}
        <span className="mt-1 block text-[15px] @4xl:hidden">
          <Marked text={hit.flow.from.join(", ")} words={words} />
          <span className="text-ink-meta"> → </span>
          <Marked text={hit.flow.to.join(", ")} words={words} />
        </span>
      </span>
      <Accounts names={hit.flow.from} words={words} />
      <Accounts names={hit.flow.to} words={words} />
      <span className="text-right font-mono text-[16px] font-medium tabular-nums">
        {formatMoney(hit.amount)}
      </span>
    </RowLink>
  );
}

/** One side of a transaction, in the table: each account on its own line. */
function Accounts({
  names,
  words,
}: {
  names: readonly string[];
  words: readonly string[];
}) {
  return (
    <span className="hidden min-w-0 text-[15px] @4xl:block">
      {names.map((name) => (
        <span key={name} className="block truncate" title={name}>
          <Marked text={name} words={words} />
        </span>
      ))}
    </span>
  );
}

function AccountResults({
  rows,
  words,
  truncated,
}: {
  rows: readonly SearchAccount[];
  words: readonly string[];
  truncated: boolean;
}) {
  return (
    <Section title="Accounts" count={rows.length} truncated={truncated}>
      {rows.map((account) => (
        <RowLink
          key={account.id}
          href={accountLedgerHref(account.id)}
          className="flex items-baseline gap-3 px-2 py-3"
        >
          <AccountName
            name={<Marked text={account.name} words={words} />}
            parentPath={account.parent_path}
            className="text-[16px] font-medium"
          />
          <span className="text-[15px] text-ink-soft">
            {account.account_type}
          </span>
        </RowLink>
      ))}
    </Section>
  );
}

function JournalResults({
  rows,
  words,
  truncated,
}: {
  rows: readonly SearchJournal[];
  words: readonly string[];
  truncated: boolean;
}) {
  const hits = rows.flatMap((journal) => journalHits(journal, words));
  return (
    <Section
      title="Transactions"
      count={hits.length}
      truncated={truncated}
      columns={<TransactionColumns />}
    >
      {hits.map((hit) => (
        <HitRow key={hit.key} hit={hit} words={words} />
      ))}
    </Section>
  );
}

function DraftResults({
  rows,
  words,
  q,
  truncated,
}: {
  rows: readonly SearchDraft[];
  words: readonly string[];
  q: string;
  truncated: boolean;
}) {
  return (
    <Section
      title="Drafts"
      count={rows.length}
      truncated={truncated}
      columns={<TransactionColumns />}
    >
      {rows.map((draft) => (
        <HitRow key={draft.id} hit={draftHit(draft, q)} words={words} />
      ))}
    </Section>
  );
}

/**
 * The lines a journal gives. One, for the journal, when its description
 * matched or no entry's text did (an account or amount matched). Otherwise
 * one per entry whose text matched: in an older journal grouping a day's
 * statement rows under "Expenses", that row is the transaction searched for.
 */
function journalHits(journal: SearchJournal, words: readonly string[]): Hit[] {
  const matches = wordMatcher(words);
  const href = journalHref(journal.id);
  const flow = journalFlow(journal);
  const entries = matches(journal.description)
    ? []
    : journal.entries.flatMap((entry) => {
        // The person's comment first, then the bank's text, then reference.
        const text = [entry.comment, entry.narration, entry.reference].find(
          matches,
        );
        return text === undefined ? [] : [{ entry, text }];
      });
  if (entries.length === 0) {
    return [
      {
        key: `${journal.id}`,
        href,
        date: journal.date,
        title: journal.description,
        flow,
        amount: journal.amount,
        partOf: null,
      },
    ];
  }
  return entries.map(({ entry, text }, index) => {
    const amount = Math.max(entry.debit, entry.credit);
    return {
      key: `${journal.id}-${index}`,
      href,
      date: journal.date,
      title: text,
      // The entry's own account, against the journal's other side.
      flow:
        entry.debit > 0
          ? { from: flow.from, to: [entry.account] }
          : { from: [entry.account], to: flow.to },
      amount,
      partOf:
        amount === journal.amount
          ? null
          : { description: journal.description, amount: journal.amount },
    };
  });
}

/**
 * Where a journal's money went: the accounts it left (net credit) and the
 * accounts it reached (net debit), each side largest first. A card purchase
 * reads "card → expense", a salary "income → bank".
 */
function journalFlow(journal: SearchJournal): Flow {
  const net = new Map<string, number>();
  for (const entry of journal.entries) {
    net.set(
      entry.account,
      (net.get(entry.account) ?? 0) + entry.debit - entry.credit,
    );
  }
  const side = (sign: 1 | -1) =>
    [...net]
      .filter(([, amount]) => amount * sign > 0)
      .sort(([, a], [, b]) => (b - a) * sign)
      .map(([account]) => account);
  return { from: side(-1), to: side(1) };
}

/**
 * A draft read the same way: a withdrawal leaves the statement's account
 * for its category, a deposit comes from its category into it.
 */
function draftHit(draft: SearchDraft, q: string): Hit {
  const statement = draft.base_account_name ?? "";
  const category = draft.account_name ?? "Not categorized";
  return {
    key: `${draft.id}`,
    href:
      draft.base_account_id === null
        ? null
        : `${reviewHref(draft.base_account_id, "drafts")}?${new URLSearchParams({ q })}`,
    date: draft.date,
    title: draft.comment ?? draft.narration,
    flow:
      draft.amount < 0
        ? { from: [statement], to: [category] }
        : { from: [category], to: [statement] },
    amount: Math.abs(draft.amount),
    partOf: null,
  };
}

/**
 * A search word as a pattern. A word of one or two letters counts only at
 * the start of a word, so "X Corp." doesn't find, or mark, the x in
 * "Expenses"; a longer one counts anywhere, as the search matches it.
 */
function wordPattern(word: string): string {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return word.length < 3 ? `(?<![\\p{L}\\p{N}])${escaped}` : escaped;
}

/** Whether a text holds any of the search's words. */
function wordMatcher(words: readonly string[]) {
  const patterns = words.map((word) => new RegExp(wordPattern(word), "iu"));
  return (text: string | null): text is string =>
    text !== null && patterns.some((pattern) => pattern.test(text));
}

/**
 * `text` with each occurrence of the search's words marked: bold on a faint
 * tint, so the word stands out without a block of colour over the line.
 */
function Marked({ text, words }: { text: string; words: readonly string[] }) {
  if (words.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${words.map(wordPattern).join("|")})`, "giu");
  return (
    <>
      {text.split(pattern).map((part, index) =>
        index % 2 === 1 ? (
          <mark
            key={index}
            className="rounded-[2px] bg-primary/[0.12] font-semibold text-inherit"
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
