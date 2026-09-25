import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { Link } from "react-router-dom";
import { cn } from "@sapporta/ui/cn";
import type { RuleExample } from "./mapping-rules";

/*
 * The pieces every tab of the categorization rules page shares: the tab
 * rows, the example atop a panel, and the one-line footer.
 */

export interface TabItem<T extends string> {
  id: T;
  label: string;
  // A muted figure beside the label.
  count?: number;
  // Muted words after the label.
  note?: string;
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
              <span className="font-normal text-ink-meta">· {tab.note}</span>
            )}
          </button>,
        ];
      })}
    </div>
  );
}

/** A bank description, its match marked, and the account it goes to. */
export function ExampleLine({ example }: { example: RuleExample }) {
  const faint = "text-ink-meta/50";
  const mark = (text: string) => (
    <mark className="rounded-[3px] bg-primary/15 px-[3px] py-px text-foreground">
      {text}
    </mark>
  );
  return (
    <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
      <span className="text-label uppercase text-ink-meta">
        {example.sample ? "Sample" : "Example"}
      </span>
      <span className="font-mono text-body text-foreground [overflow-wrap:anywhere]">
        {example.kind === "whole" ? (
          mark(example.text)
        ) : example.kind === "phrase" ? (
          <>
            <span className={faint}>…</span>
            {mark(example.text)}
            <span className={faint}>…</span>
          </>
        ) : (
          example.text
        )}
      </span>
      {example.account !== null && (
        <>
          <span aria-hidden="true" className={cn("text-heading", faint)}>
            →
          </span>
          <span className="sr-only">goes to</span>
          <span className="text-subheading font-bold text-foreground">
            {example.account}
          </span>
        </>
      )}
    </div>
  );
}

/** A panel's example and one-line caption, and its search at the right. */
export function PanelHead({
  example,
  caption,
  search,
}: {
  example: RuleExample | null;
  caption: ReactNode;
  search?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3 pb-4">
      <div className="min-w-0 space-y-2">
        {example !== null && <ExampleLine example={example} />}
        <p className="text-meta text-ink-meta">{caption}</p>
      </div>
      {search}
    </div>
  );
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
      className="block w-full max-w-[260px] rounded-control border border-sap-border-strong bg-card px-3 py-1.5 text-meta text-foreground placeholder:text-ink-meta"
    />
  );
}

/** The faint arrow between a rule and its account. */
export function RuleArrow({ className }: { className?: string }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn("text-center text-ink-meta/50", className)}
      >
        →
      </span>
      <span className="sr-only">goes to</span>
    </>
  );
}

/** "not in your books" beside an account the ledger doesn't have. */
export function NotInBooks() {
  return (
    <span className="text-meta font-normal text-ink-meta">
      not in your books
    </span>
  );
}

/** Where a tab's rules are edited, and where to teach them from drafts. */
export function EditFooter({
  file,
  teachHref,
}: {
  file: string;
  teachHref: string | null;
}) {
  return (
    <div className="mt-6 flex flex-wrap gap-x-5 gap-y-1 text-meta text-ink-meta">
      <span>
        Edit{" "}
        <code className="font-mono [overflow-wrap:anywhere]">
          user-config/{file}
        </code>
        , or ask your coding agent.
      </span>
      {teachHref !== null && (
        <Link
          to={teachHref}
          className="font-semibold text-ink-soft no-underline hover:text-foreground hover:underline"
        >
          Teach from your drafts →
        </Link>
      )}
    </div>
  );
}
