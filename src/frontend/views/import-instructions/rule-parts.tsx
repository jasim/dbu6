import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { cn } from "@sapporta/ui/cn";

/*
 * The pieces every tab of the categorization rules page shares: the tab
 * rows, what the step does atop a panel, bank descriptions, the card of
 * rules, and the one-line footer.
 */

export interface TabItem<T extends string> {
  id: T;
  label: string;
  // A muted figure beside the label.
  count?: number;
  // Muted words after the label; in the attention ink when the user must
  // act on them.
  note?: string;
  noteAttention?: boolean;
}

/**
 * A row of text tabs on a rule, the chosen one underlined. The primary row
 * is large, its tabs joined by faint arrows to show their order; the
 * secondary row is small and underlined in ink. Arrow keys, Home and End
 * move between the tabs, choosing as they go.
 */
export function TabList<T extends string>({
  label,
  tabs,
  selected,
  onSelect,
  tabId,
  panelId,
  primary = false,
}: {
  label: string;
  tabs: readonly TabItem<T>[];
  selected: T;
  onSelect: (id: T) => void;
  tabId: (id: T) => string;
  panelId: string;
  primary?: boolean;
}) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const onKeyDown = (event: KeyboardEvent) => {
    const at = tabs.findIndex((tab) => tab.id === selected);
    const to =
      event.key === "ArrowRight"
        ? (at + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (at - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : null;
    const next = to === null ? undefined : tabs[to];
    if (next === undefined) return;
    event.preventDefault();
    onSelect(next.id);
    buttons.current.get(next.id)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "flex min-w-0 items-center overflow-x-auto overflow-y-hidden border-b border-sap-border",
        !primary && "gap-x-5",
      )}
    >
      {tabs.map((tab, index) => {
        const chosen = tab.id === selected;
        return [
          primary && index > 0 && (
            <span
              key={`${tab.id}-arrow`}
              aria-hidden="true"
              className="shrink-0 px-2.5 text-heading font-normal text-ink-meta/50"
            >
              →
            </span>
          ),
          <button
            key={tab.id}
            ref={(button) => {
              if (button) buttons.current.set(tab.id, button);
              else buttons.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={tabId(tab.id)}
            aria-selected={chosen}
            aria-controls={panelId}
            tabIndex={chosen ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className={cn(
              "-mb-px inline-flex shrink-0 items-baseline gap-2 whitespace-nowrap border-b-2 outline-none focus-visible:underline",
              primary
                ? "px-0.5 pb-3 pt-2.5 text-heading"
                : "pb-2 pt-1.5 text-meta font-semibold",
              chosen
                ? cn(
                    "text-foreground",
                    primary ? "border-primary" : "border-foreground",
                  )
                : "border-transparent text-ink-meta hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="tnum text-meta font-medium text-ink-meta max-sm:hidden">
                {tab.count}
              </span>
            )}
            {tab.note !== undefined && (
              <span
                className={cn(
                  "font-normal",
                  tab.noteAttention ? "text-attention-ink" : "text-ink-meta",
                )}
              >
                · {tab.note}
              </span>
            )}
          </button>,
        ];
      })}
    </div>
  );
}

/**
 * What a tab's step does, for someone who has never seen it: a heading
 * that says it in plain words, and a line with an example.
 */
export function HowItWorks({
  title,
  detail,
}: {
  title: string;
  detail: ReactNode;
}) {
  return (
    <div>
      <h2 className="text-heading text-foreground">{title}</h2>
      <p className="mt-1.5 max-w-[72ch] text-body text-ink-soft">{detail}</p>
    </div>
  );
}

// A bank description as the page shows it: in a rule's chip, or in a
// sentence.
const DESCRIPTION =
  "rounded-[5px] border border-line-inner bg-sap-nested px-2 py-0.5 font-mono text-meta text-foreground [overflow-wrap:anywhere]";

/** A bank description inside a sentence; a part of it may be marked. */
export function Description({ children }: { children: ReactNode }) {
  return <span className={cn(DESCRIPTION, "px-1.5 py-px")}>{children}</span>;
}

/** The part of a description a rule matches. */
export function Matched({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded-[3px] bg-primary/15 px-[2px] text-foreground">
      {children}
    </mark>
  );
}

/**
 * The white card a tab's rules sit in: a heading that says how they are
 * laid out, the search at its right, and the rules under it.
 */
export function RuleCard({
  title,
  search,
  children,
}: {
  title: string;
  search?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-7 rounded-card border border-sap-border bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pb-3 pt-4">
        <h3 className="text-subheading text-foreground">{title}</h3>
        {search}
      </div>
      {children}
    </section>
  );
}

/** One description or phrase of a rule. */
export function Chip({ children }: { children: ReactNode }) {
  return <li className={DESCRIPTION}>{children}</li>;
}

/** The search box above a list of rules. */
export function FindInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Find"
      aria-label={label}
      className="block h-sap-ctl w-full max-w-[240px] rounded-control border border-sap-border-strong bg-card px-3 text-row text-foreground placeholder:text-ink-meta"
    />
  );
}

/**
 * "not in your books" beside an account the ledger doesn't have: what the
 * rule matches stays uncategorized, so the user must act.
 */
export function NotInBooks() {
  return (
    <span
      title="What this matches stays uncategorized. Add the account to your books, or change the rule."
      className="text-meta font-normal text-attention-ink"
    >
      not in your books
    </span>
  );
}

/** Where a tab's rules are edited. */
export function EditFooter({ file }: { file: string }) {
  return (
    <p className="mt-5 text-meta text-ink-soft">
      Edit{" "}
      <code className="font-mono [overflow-wrap:anywhere]">
        user-config/{file}
      </code>
      , or ask your coding agent.
    </p>
  );
}
