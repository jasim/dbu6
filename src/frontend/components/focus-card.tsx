import { Fragment, useId, type ReactNode } from "react";
import { cn } from "@sapporta/ui/cn";
import { ArrowLeft, Check } from "lucide-react";
import { Link, Outlet } from "react-router-dom";
import { apiErrorMessage } from "../api";
import { Brand } from "./brand";
import { Button } from "./ui/button";

/*
 * Focus mode (PLAN.md "The rule every screen follows"): the page holds one
 * card, which asks one question and has one primary button. No sidebar, no
 * navigation: a header says which app and which flow this is, the first
 * run's steps say how far along it is, and Back to Home leaves. Onboarding
 * and every later "add a bank or card" run through it.
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

/** One of a flow's steps, as the list over the card names it. */
export interface FocusStep {
  label: string;
  /** A count beside the label: "2 added". */
  note?: string;
}

/** Where a card sits in its flow: the header's words, and its steps. */
export interface FocusFrame {
  /** The flow's name, in the header: "Set up your books". */
  flow: string;
  /** The flow's steps and the one this card is in; absent for one-step flows. */
  steps?: { list: readonly FocusStep[]; at: number };
}

export interface FocusCardProps extends FocusFrame {
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

/**
 * A focus-mode page: the header, the flow's steps, and one centred card.
 * Back to Home leaves the flow; Home resumes it from the books.
 */
export function FocusCard({
  flow,
  steps,
  title,
  lead,
  children,
  actions,
}: FocusCardProps) {
  const titleId = useId();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-sap-border bg-card px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <Brand />
          <span className="text-row font-semibold tracking-[-0.01em] text-foreground max-sm:sr-only">
            dbu6
          </span>
          <span aria-hidden="true" className="text-ink-meta max-sm:hidden">
            /
          </span>
          <p className="min-w-0 truncate text-body font-semibold text-foreground">
            {flow}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          render={<Link to="/" />}
          nativeButton={false}
        >
          <ArrowLeft aria-hidden="true" />
          <span>
            <span className="max-sm:sr-only">Back to </span>Home
          </span>
        </Button>
      </header>
      <div className="flex flex-1 justify-center px-4 pb-16 pt-6 sm:pt-[8vh]">
        <div className="w-full max-w-[560px]">
          {steps && <Steps {...steps} />}
          <section
            aria-labelledby={titleId}
            className="h-fit w-full rounded-card border border-sap-border bg-card px-5 py-6 shadow-card sm:px-8 sm:py-8"
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
    </div>
  );
}

/**
 * The flow's steps over the card: those done ticked, this one named in
 * full. On a phone only this one's label shows; the others are numbers.
 */
function Steps({ list, at }: NonNullable<FocusFrame["steps"]>) {
  return (
    <ol
      aria-label="Steps"
      className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta"
    >
      {list.map((step, i) => {
        const done = i < at;
        const current = i === at;
        return (
          <Fragment key={step.label}>
            {i > 0 && (
              <li
                aria-hidden="true"
                className="h-px w-3 bg-sap-border-strong sm:w-5"
              />
            )}
            <li
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5",
                current ? "font-semibold text-foreground" : "text-ink-meta",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  done && "bg-primary/15 text-primary",
                  current && "bg-primary text-primary-foreground",
                  !done && !current && "border border-sap-border-strong",
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn(!current && "max-sm:sr-only")}>
                {step.label}
                {step.note && (
                  <span className="font-normal text-ink-meta">
                    {" · "}
                    {step.note}
                  </span>
                )}
                {done && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
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

/**
 * A card waiting on the books: "Loading…", or, when the read failed, what
 * went wrong and Try again.
 */
export function FocusLoading({
  error,
  retry,
  ...frame
}: FocusFrame & {
  /** The failed read's error; null while it is still loading. */
  error: unknown;
  retry: () => void;
}) {
  if (error === null) return <FocusCard {...frame} title="Loading…" />;
  return (
    <FocusCard
      {...frame}
      title="Couldn't load your accounts"
      lead={
        <span role="alert" className="text-destructive">
          {apiErrorMessage(error)}
        </span>
      }
      actions={<Button onClick={retry}>Try again</Button>}
    />
  );
}

/** A card's field: its label, a hint under it if any, then the control. */
export function Field({
  id,
  label,
  hint,
  children,
}: {
  /** The control the label names. */
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-row font-semibold text-foreground"
      >
        {label}
      </label>
      {hint && <p className="text-meta text-ink-meta">{hint}</p>}
      {children}
    </div>
  );
}
