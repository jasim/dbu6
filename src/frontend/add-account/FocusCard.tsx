import { useId, type ReactNode } from "react";
import { cn } from "@sapporta/ui/cn";
import { Link, Outlet } from "react-router-dom";

/*
 * Focus mode (PLAN.md "The rule every screen follows"): the page holds one
 * card, which asks one question and has one primary button. No sidebar, no
 * navigation: a thin line on top says where the user is, and a quiet link
 * leaves. Onboarding and every later "add a bank or card" run through it.
 */

/**
 * The layout of the focus routes, in place of the app shell: the page
 * alone, scrolling as a document does.
 */
export function FocusLayout() {
  return (
    <main className="min-h-dvh bg-sap-surface">
      <Outlet />
    </main>
  );
}

export interface FocusCardProps {
  /** The thin line on top: "Setting up your books · 2 accounts added". */
  context: string;
  /** The card's one question or statement. */
  title: string;
  /** A sentence under the title, when the title needs one. */
  lead?: ReactNode;
  /** What the card shows or asks between the title and its buttons. */
  children?: ReactNode;
  /**
   * The card's buttons: one primary, and at most a quiet way or two
   * beside it. They sit at the card's foot, the primary last.
   */
  actions?: ReactNode;
}

/** What every card of a flow shares: its context line. */
export type FocusFrame = Pick<FocusCardProps, "context">;

/**
 * A focus-mode page: the context line, one centred card, and Leave, which
 * goes Home: Home resumes from the books.
 */
export function FocusCard({
  context,
  title,
  lead,
  children,
  actions,
}: FocusCardProps) {
  const titleId = useId();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <p className="min-w-0 truncate text-meta text-ink-meta">{context}</p>
        <Link
          to="/"
          className="shrink-0 rounded-control text-meta font-semibold text-ink-soft outline-none hover:text-foreground hover:underline hover:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          Leave
        </Link>
      </header>
      <div className="flex flex-1 justify-center px-4 pb-16 pt-[4vh] sm:pt-[10vh]">
        <section
          aria-labelledby={titleId}
          className="h-fit w-full max-w-[560px] rounded-card border border-sap-border bg-card px-5 py-6 shadow-card sm:px-8 sm:py-8"
        >
          <h1
            id={titleId}
            className="text-heading text-foreground [overflow-wrap:anywhere] sm:text-title"
          >
            {title}
          </h1>
          {lead && (
            <div className="mt-2 text-body text-ink-soft [overflow-wrap:anywhere]">
              {lead}
            </div>
          )}
          {children && <div className="mt-5">{children}</div>}
          {actions && (
            <div className="mt-7 flex flex-wrap items-start justify-end gap-x-3 gap-y-2">
              {actions}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * One answer to a card's question: a radio and its words, the whole row
 * clickable. Answers sharing a `name` are one question.
 */
export function Choice({
  name,
  checked,
  onCheck,
  children,
}: {
  name: string;
  checked: boolean;
  onCheck: () => void;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex min-h-[calc(var(--height-sap-ctl)+18px)] cursor-pointer items-center gap-3 rounded-control border px-3.5 py-2 text-body text-foreground transition-colors duration-150",
        checked ? "border-primary bg-card" : "border-sap-border hover:bg-muted",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onCheck}
        className="size-4 shrink-0 accent-primary"
      />
      {children}
    </label>
  );
}
