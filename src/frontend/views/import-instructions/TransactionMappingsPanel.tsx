import { type ReactNode, useDeferredValue, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiErrorMessage } from "../../api";
import { LoadError } from "../../components/load-error";
import { StatusChip } from "../../components/status-chip";
import { transactionMappingsQuery } from "../../queries";
import {
  accountsNotInLedger,
  filterMappings,
  ruleCount,
  type ReadMappings,
} from "./mapping-rules";

/*
 * The common rules, in transaction_mappings.mjs, which every account's entries go
 * through before any guidance: the whole narrations first, then the
 * "contains" rules in the order they are checked. Read-only; the file is
 * edited in user-config/.
 */
export function TransactionMappingsPanel() {
  const headingId = useId();
  const mappings = useQuery(transactionMappingsQuery);

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-6">
      <div>
        <h2 id={headingId} className="text-heading text-foreground">
          Common rules
        </h2>
        <p className="mt-0.5 text-meta text-ink-meta">
          Applies to every account, before its own guidance
        </p>
      </div>

      {mappings.isPending && (
        <p className="text-meta text-ink-meta">Reading the file…</p>
      )}
      {mappings.isError && (
        <LoadError
          title="Couldn't read the rules"
          message={apiErrorMessage(mappings.error)}
          retry={() => void mappings.refetch()}
        />
      )}
      {mappings.data?.state === "unreadable" && (
        <div className="space-y-1 rounded-control border border-dashed px-3 py-2">
          <p className="text-body text-attention-ink">
            The rules file doesn't load, so nothing is categorized until it's
            fixed.
          </p>
          <p className="font-mono text-meta text-ink-meta [overflow-wrap:anywhere]">
            {mappings.data.error}
          </p>
        </div>
      )}
      {mappings.data?.state === "read" && <Rules mappings={mappings.data} />}

      <p className="text-meta text-ink-meta">
        Edit user-config/transaction_mappings.mjs, or ask your coding agent to.
      </p>
    </section>
  );
}

function Rules({ mappings }: { mappings: ReadMappings }) {
  const filterId = useId();
  const [query, setQuery] = useState("");
  const shown = filterMappings(mappings, useDeferredValue(query));
  const missing = accountsNotInLedger(mappings);

  return (
    <>
      {missing.length > 0 && (
        <div className="space-y-1 rounded-control border border-dashed px-3 py-2">
          <p className="text-body text-attention-ink">
            {missing.length === 1
              ? "1 account these rules name isn't in your books"
              : `${missing.length} accounts these rules name aren't in your books`}
            , so what they match stays uncategorized.
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink-meta">
            {missing.map(({ account, rules }) => (
              <li key={account}>
                <span className="font-mono text-foreground">{account}</span> (
                {rules === 1 ? "1 rule" : `${rules} rules`})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1">
        <label
          htmlFor={filterId}
          className="text-meta font-medium text-ink-soft"
        >
          Find a rule{" "}
          <span className="font-normal text-ink-meta">
            ({ruleCount(mappings)} in all)
          </span>
        </label>
        <input
          id={filterId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="A narration, a value or an account"
          className="block w-full max-w-[360px] rounded-control border border-sap-border-strong bg-card px-3 py-1.5 text-body text-foreground placeholder:text-ink-meta"
        />
      </div>

      <RuleTable
        title="Whole narration"
        description="Checked first. Case and spacing don't matter; a UPI address also matches inside a longer narration."
        count={shown.exact.length}
        total={mappings.exact.length}
        head={["Narration", "Account"]}
      >
        {shown.exact.map((rule) => (
          <tr key={rule.narration} className="border-t align-top">
            <td className="py-2 pl-4 pr-3 font-mono text-meta [overflow-wrap:anywhere]">
              {rule.narration}
            </td>
            <AccountCell account={rule.account} inLedger={rule.in_ledger} />
          </tr>
        ))}
      </RuleTable>

      <RuleTable
        title="Narration contains"
        description="Checked in this order; the first match wins."
        count={shown.includes.length}
        total={mappings.includes.length}
        head={["#", "Contains any of", "Money", "Account"]}
      >
        {shown.includes.map((rule) => (
          <tr key={rule.position} className="border-t align-top">
            <td className="tnum py-2 pl-4 pr-3 text-meta text-ink-meta">
              {rule.position}
            </td>
            <td className="px-3 py-2">
              <ul className="space-y-0.5 font-mono text-meta [overflow-wrap:anywhere]">
                {rule.values.map((value) => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-meta text-ink-meta">
              {rule.direction === "withdrawal"
                ? "Out"
                : rule.direction === "deposit"
                  ? "In"
                  : "Either way"}
            </td>
            <AccountCell account={rule.account} inLedger={rule.in_ledger} />
          </tr>
        ))}
      </RuleTable>
    </>
  );
}

function RuleTable({
  title,
  description,
  count,
  total,
  head,
  children,
}: {
  title: string;
  description: string;
  count: number;
  total: number;
  head: readonly string[];
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-row font-semibold text-foreground">
          {title}{" "}
          <span className="font-normal text-ink-meta">
            {count === total ? total : `${count} of ${total}`}
          </span>
        </h3>
        <p className="text-meta text-ink-meta">{description}</p>
      </div>
      {count === 0 ? (
        <p className="rounded-control border border-dashed px-3 py-2 text-meta text-ink-meta">
          {total === 0 ? "None in the file." : "None match."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-control border bg-card">
          <table className="w-full text-row">
            <thead className="text-left text-meta text-ink-meta">
              <tr>
                {head.map((label, index) => (
                  <th
                    key={label}
                    scope="col"
                    className={
                      index === 0
                        ? "py-2 pl-4 pr-3 font-medium"
                        : "px-3 py-2 font-medium last:pr-4"
                    }
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AccountCell({
  account,
  inLedger,
}: {
  account: string;
  inLedger: boolean;
}) {
  return (
    <td className="py-2 pl-3 pr-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-meta text-foreground">{account}</span>
        {!inLedger && (
          <StatusChip tone="attention">Not in your books</StatusChip>
        )}
      </div>
    </td>
  );
}
