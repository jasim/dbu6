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
import { formatDate, formatMoney } from "../../format";
import { searchQuery } from "../../queries";
import { accountLedgerHref, journalHref } from "../../reports/links";
import { reviewHref } from "../../review/routes";
import { Matched } from "../import-instructions/rule-parts";

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
  children,
}: {
  title: string;
  count: number;
  truncated: boolean;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section>
      <h2 className="text-heading text-foreground">
        {title}{" "}
        <span className="text-row font-normal text-ink-meta">
          {truncated ? `first ${SEARCH_LIMIT}` : count}
        </span>
      </h2>
      <ul className="mt-2 divide-y divide-sap-border border-y border-sap-border">
        {children}
      </ul>
    </section>
  );
}

function ResultRow({
  to,
  date,
  amount,
  children,
}: {
  to: string | null;
  date?: string;
  amount?: number;
  children: ReactNode;
}) {
  const body = (
    <>
      {date !== undefined && (
        <span className="w-24 shrink-0 text-meta tabular-nums text-ink-meta">
          {formatDate(date)}
        </span>
      )}
      <span className="min-w-0 flex-1">{children}</span>
      {amount !== undefined && (
        <span className="shrink-0 text-row tabular-nums text-foreground">
          {formatMoney(amount)}
        </span>
      )}
    </>
  );
  const row = "flex items-baseline gap-3 px-2 py-2 text-row";
  return (
    <li>
      {to ? (
        <Link
          to={to}
          className={`${row} text-foreground no-underline hover:bg-sap-nav-hover`}
        >
          {body}
        </Link>
      ) : (
        <div className={row}>{body}</div>
      )}
    </li>
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
        <ResultRow key={account.id} to={accountLedgerHref(account.id)}>
          <Marked text={account.name} words={words} />
          <span className="ml-2 text-meta text-ink-meta">
            {account.account_type}
          </span>
        </ResultRow>
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
  return (
    <Section title="Transactions" count={rows.length} truncated={truncated}>
      {rows.map((journal) => (
        <ResultRow
          key={journal.id}
          to={journalHref(journal.id)}
          date={journal.date}
          amount={journal.amount}
        >
          <span className="block truncate">
            <Marked text={journal.description} words={words} />
          </span>
          <span className="block truncate text-meta text-ink-meta">
            <Marked text={journal.accounts.join(" · ")} words={words} />
          </span>
        </ResultRow>
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
    <Section title="Drafts" count={rows.length} truncated={truncated}>
      {rows.map((draft) => (
        <ResultRow
          key={draft.id}
          to={
            draft.base_account_id === null
              ? null
              : `${reviewHref(draft.base_account_id, "drafts")}?${new URLSearchParams({ q })}`
          }
          date={draft.date}
          amount={draft.amount}
        >
          <span className="block truncate">
            <Marked text={draft.comment ?? draft.narration} words={words} />
          </span>
          <span className="block truncate text-meta text-ink-meta">
            {draft.comment !== null && (
              <>
                <Marked text={draft.narration} words={words} />
                {" · "}
              </>
            )}
            <Marked
              text={[
                draft.base_account_name,
                draft.account_name ?? "Not categorized",
              ]
                .filter(Boolean)
                .join(" → ")}
              words={words}
            />
          </span>
        </ResultRow>
      ))}
    </Section>
  );
}

/** `text` with each occurrence of the search's words marked. */
function Marked({ text, words }: { text: string; words: readonly string[] }) {
  if (words.length === 0) return <>{text}</>;
  const pattern = new RegExp(
    `(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return (
    <>
      {text
        .split(pattern)
        .map((part, index) =>
          index % 2 === 1 ? <Matched key={index}>{part}</Matched> : part,
        )}
    </>
  );
}
