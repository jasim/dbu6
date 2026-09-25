import { type ReactNode, useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@sapporta/ui/cn";
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
  Chip,
  Description,
  EditFooter,
  FindInput,
  HowItWorks,
  Matched,
  NotInBooks,
  RuleCard,
} from "./rule-parts";

/*
 * The Exact and Contains tabs: the rules in transaction_mappings.mjs, which
 * every account's transactions meet before the AI does. Read-only; the
 * file is edited in user-config/.
 */
export function RulesPanel({ tab }: { tab: "exact" | "contains" }) {
  const mappings = useQuery(transactionMappingsQuery);
  const data = mappings.data;
  return (
    <>
      {mappings.isPending && (
        <p className="text-body text-ink-soft">Reading the rules…</p>
      )}
      {mappings.isError && (
        <LoadError
          title="Couldn't read the rules"
          message={apiErrorMessage(mappings.error)}
          retry={() => void mappings.refetch()}
        />
      )}
      {data?.state === "unreadable" && (
        <LoadError
          title="The rules file doesn't load, so nothing is categorized until it's fixed."
          message={data.error}
          retry={() => void mappings.refetch()}
        />
      )}
      {data?.state === "read" &&
        (tab === "exact" ? (
          <ExactRules mappings={data} />
        ) : (
          <ContainsRules mappings={data} />
        ))}
      <EditFooter file={data?.filename ?? "transaction_mappings.mjs"} />
    </>
  );
}

// How many of an account's descriptions show before "+N".
const FIRST_DESCRIPTIONS = 6;

/**
 * One row per account, its descriptions under it: those whose account the
 * books don't have first, then most rules first.
 */
function ExactRules({ mappings }: { mappings: ReadMappings }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const deferred = useDeferredValue(query);
  // A search shows every description it finds.
  const finding = deferred.trim() !== "";
  const rows = exactByAccount(mappings, deferred);
  const example = exactExample(mappings);

  return (
    <>
      <HowItWorks
        title="When the whole description matches"
        detail={
          <>
            e.g. <Description>{example.text}</Description>, but not{" "}
            <Description>{example.longer}</Description>. Checked first.
          </>
        }
      />
      <RuleCard
        title="Descriptions, by account"
        search={
          mappings.exact.length > 0 && (
            <FindInput
              value={query}
              onChange={setQuery}
              label="Find a description or account"
            />
          )
        }
      >
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
              <li key={row.account} className={ROW}>
                <Account name={row.account} inLedger={row.in_ledger} />
                <ul className={CHIPS}>
                  {shown.map((text, index) => (
                    <Chip key={index}>{text}</Chip>
                  ))}
                  {more > 0 && (
                    <li>
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((was) => new Set(was).add(row.account))
                        }
                        aria-label={`Show ${more} more for ${row.account}`}
                        className="rounded-[5px] px-1.5 py-0.5 text-meta font-semibold text-primary hover:underline hover:underline-offset-4"
                      >
                        +{more}
                      </button>
                    </li>
                  )}
                </ul>
              </li>
            );
          })}
        </RuleRows>
      </RuleCard>
    </>
  );
}

/** One row per rule, numbered in the order they are checked. */
function ContainsRules({ mappings }: { mappings: ReadMappings }) {
  const [query, setQuery] = useState("");
  const rules = findIncludes(mappings, useDeferredValue(query));
  const example = containsExample(mappings);

  return (
    <>
      <HowItWorks
        title="When the description contains a phrase"
        detail={
          <>
            e.g. <Description>{example.phrase}</Description>, anywhere in{" "}
            <Description>
              {example.before}
              <Matched>{example.phrase}</Matched>
              {example.after}
            </Description>
            . Checked next; the first match wins.
          </>
        }
      />
      <RuleCard
        title="Phrases, in the order they're checked"
        search={
          mappings.includes.length > 0 && (
            <FindInput
              value={query}
              onChange={setQuery}
              label="Find a phrase or account"
            />
          )
        }
      >
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
              className={cn(ROW, "grid grid-cols-[24px_minmax(0,1fr)] gap-x-2")}
            >
              <span className="tnum pt-px text-row text-ink-meta">
                {rule.position}
              </span>
              <div>
                <Account name={rule.account} inLedger={rule.in_ledger}>
                  {rule.direction !== null && (
                    <span className="text-meta font-normal text-ink-soft">
                      {rule.direction === "withdrawal"
                        ? "money out"
                        : "money in"}
                    </span>
                  )}
                </Account>
                <ul className={CHIPS}>
                  {rule.values.map((value, index) => (
                    <Chip key={index}>{value}</Chip>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </RuleRows>
      </RuleCard>
    </>
  );
}

const ROW = "border-t border-line-inner px-5 py-3.5";
const CHIPS = "mt-2 flex flex-wrap gap-1.5";

function RuleRows({
  empty,
  children,
}: {
  empty: string;
  children: ReactNode[];
}) {
  return children.length === 0 ? (
    <p className="border-t border-line-inner px-5 py-4 text-body text-ink-soft">
      {empty}
    </p>
  ) : (
    <ul>{children}</ul>
  );
}

/** A rule's account in bold, with facts beside it. */
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
    <p className="flex flex-wrap items-baseline gap-x-2.5 text-row font-semibold text-foreground">
      {name}
      {children}
      {!inLedger && <NotInBooks />}
    </p>
  );
}
