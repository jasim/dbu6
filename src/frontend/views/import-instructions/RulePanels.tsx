import { Fragment, type ReactNode, useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiErrorMessage } from "../../api";
import { LoadError } from "../../components/load-error";
import { transactionMappingsQuery } from "../../queries";
import {
  containsExample,
  exactByAccount,
  exactExample,
  findIncludes,
  type ReadMappings,
} from "./mapping-rules";
import {
  EditFooter,
  FindInput,
  NotInBooks,
  PanelHead,
  RuleArrow,
} from "./rule-parts";

/*
 * The Exact and Contains tabs: the rules in transaction_mappings.mjs, which
 * every account's transactions meet before the AI does. Read-only; the
 * file is edited in user-config/.
 */
export function RulesPanel({
  tab,
  teachHref,
}: {
  tab: "exact" | "contains";
  teachHref: string | null;
}) {
  const mappings = useQuery(transactionMappingsQuery);
  const data = mappings.data;
  return (
    <>
      {mappings.isPending && (
        <p className="text-meta text-ink-meta">Reading the rules…</p>
      )}
      {mappings.isError && (
        <LoadError
          title="Couldn't read the rules"
          message={apiErrorMessage(mappings.error)}
          retry={() => void mappings.refetch()}
        />
      )}
      {data?.state === "unreadable" && (
        <div className="space-y-1">
          <p className="text-body text-foreground">
            The rules file doesn't load, so nothing is categorized until it's
            fixed.
          </p>
          <p className="font-mono text-meta text-ink-meta [overflow-wrap:anywhere]">
            {data.error}
          </p>
        </div>
      )}
      {data?.state === "read" &&
        (tab === "exact" ? (
          <ExactRules mappings={data} />
        ) : (
          <ContainsRules mappings={data} />
        ))}
      <EditFooter
        file={data?.filename ?? "transaction_mappings.mjs"}
        teachHref={teachHref}
      />
    </>
  );
}

// How many of an account's descriptions show before "+N".
const FIRST_DESCRIPTIONS = 3;

/** One row per account, its descriptions beside it, most rules first. */
function ExactRules({ mappings }: { mappings: ReadMappings }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const deferred = useDeferredValue(query);
  // A search shows every description it finds.
  const finding = deferred.trim() !== "";
  const rows = exactByAccount(mappings, deferred);

  return (
    <>
      <PanelHead
        example={exactExample(mappings)}
        caption={
          <span title="Case and spacing don't matter. A UPI address also matches inside a longer description.">
            The whole description, word for word. Checked first.
          </span>
        }
        search={
          mappings.exact.length > 0 && (
            <FindInput
              value={query}
              onChange={setQuery}
              label="Find a description or account"
            />
          )
        }
      />
      <RuleRows
        empty={
          mappings.exact.length === 0
            ? "No exact rules yet."
            : `Nothing matches “${query.trim()}”.`
        }
      >
        {rows.map((row) => {
          const open = finding || expanded.has(row.account);
          const shown = open
            ? row.found
            : row.found.slice(0, FIRST_DESCRIPTIONS);
          const more = row.found.length - shown.length;
          return (
            <li
              key={row.account}
              className="grid gap-x-3.5 gap-y-0.5 border-b border-line-inner px-0.5 py-2.5 md:grid-cols-[minmax(0,1fr)_28px_220px] md:items-baseline"
            >
              <span className="font-mono text-meta text-ink-soft [overflow-wrap:anywhere]">
                <Joined items={shown} render={(text) => text} />
                {more > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((was) => new Set(was).add(row.account))
                    }
                    aria-label={`Show ${more} more for ${row.account}`}
                    className="ml-2 font-sans text-meta font-semibold text-foreground underline decoration-sap-border-strong underline-offset-2 hover:decoration-foreground"
                  >
                    +{more}
                  </button>
                )}
              </span>
              <RuleArrow className="max-md:hidden" />
              <Account name={row.account} inLedger={row.in_ledger}>
                <span className="tnum text-meta font-normal text-ink-meta">
                  {row.narrations.length}
                </span>
              </Account>
            </li>
          );
        })}
      </RuleRows>
    </>
  );
}

/** One row per rule, numbered in the order they are checked. */
function ContainsRules({ mappings }: { mappings: ReadMappings }) {
  const [query, setQuery] = useState("");
  const rules = findIncludes(mappings, useDeferredValue(query));
  const faint = "text-ink-meta/50";

  return (
    <>
      <PanelHead
        example={containsExample(mappings)}
        caption="A phrase anywhere in the description. Checked top to bottom; the first match wins."
        search={
          mappings.includes.length > 0 && (
            <FindInput
              value={query}
              onChange={setQuery}
              label="Find a phrase or account"
            />
          )
        }
      />
      <RuleRows
        empty={
          mappings.includes.length === 0
            ? "No contains rules yet."
            : `Nothing matches “${query.trim()}”.`
        }
      >
        {rules.map((rule) => (
          <li
            key={rule.position}
            className="grid gap-x-3.5 gap-y-0.5 border-b border-line-inner px-0.5 py-2.5 md:grid-cols-[26px_minmax(0,1fr)_28px_220px] md:items-baseline"
          >
            <span className="tnum text-meta text-ink-meta max-md:hidden">
              {rule.position}
            </span>
            <span className="font-mono text-meta text-ink-soft [overflow-wrap:anywhere]">
              <Joined
                items={rule.values}
                render={(value) => (
                  <>
                    <span className={faint}>…</span>
                    {value}
                    <span className={faint}>…</span>
                  </>
                )}
              />
            </span>
            <RuleArrow className="max-md:hidden" />
            <Account name={rule.account} inLedger={rule.in_ledger}>
              {rule.direction !== null && (
                <span className="text-meta font-normal text-ink-meta">
                  {rule.direction === "withdrawal" ? "money out" : "money in"}
                </span>
              )}
            </Account>
          </li>
        ))}
      </RuleRows>
    </>
  );
}

function RuleRows({
  empty,
  children,
}: {
  empty: string;
  children: ReactNode[];
}) {
  return children.length === 0 ? (
    <p className="border-t border-sap-border px-0.5 py-4 text-body text-ink-meta">
      {empty}
    </p>
  ) : (
    <ul className="border-t border-sap-border">{children}</ul>
  );
}

/** Items joined by a faint middle dot. */
function Joined({
  items,
  render,
}: {
  items: readonly string[];
  render: (item: string) => ReactNode;
}) {
  return items.map((item, index) => (
    <Fragment key={index}>
      {index > 0 && (
        <span aria-hidden="true" className="px-1.5 text-ink-meta/50">
          ·
        </span>
      )}
      <span>{render(item)}</span>
    </Fragment>
  ));
}

/** A rule's account in bold, with muted facts beside it. */
function Account({
  name,
  inLedger,
  children,
}: {
  name: string;
  inLedger: boolean;
  children?: ReactNode;
}) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 text-row font-semibold text-foreground">
      <span
        aria-hidden="true"
        className="font-normal text-ink-meta/50 md:hidden"
      >
        →
      </span>
      {name}
      {children}
      {!inLedger && <NotInBooks />}
    </span>
  );
}
