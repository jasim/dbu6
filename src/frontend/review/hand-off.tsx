import { Link } from "react-router-dom";
import { cn } from "@sapporta/ui/cn";
import { EmptyState } from "../components/empty-state";
import { Button } from "../components/ui/button";
import { BOOKS_SET_UP, BOOKS_SET_UP_NEXT } from "./overview-state";

/*
 * Cards 7 and 8 of /add (PLAN.md "The cards"), as Review shows them: the
 * hand-off note where the flow lands, and the first run's end once nothing
 * is left to post.
 */

/** The note above the account list or the Drafts tab, on `?imported=1`. */
export function HandOffNote({ className }: { className?: string }) {
  return (
    <p
      role="status"
      className={cn(
        "rounded-card border border-money-in-border bg-money-in-bg px-4 py-2.5 text-body text-money-in-ink",
        className,
      )}
    >
      Your transactions are imported. Categorize them, then post them to your
      books.
    </p>
  );
}

/** Review's empty state on the first run, once nothing is left to post. */
export function BooksSetUp({ className }: { className?: string }) {
  return (
    <EmptyState
      className={className}
      title={BOOKS_SET_UP}
      body="Everything you imported is in your books."
      action={
        <Button
          render={<Link to={BOOKS_SET_UP_NEXT.to} />}
          nativeButton={false}
          variant="outline"
          size="sm"
        >
          {BOOKS_SET_UP_NEXT.label}
        </Button>
      }
    />
  );
}
