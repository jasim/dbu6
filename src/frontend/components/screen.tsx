import type { ReactNode } from "react";
import { cn } from "@sapporta/ui/cn";

const WIDTH = {
  /** Home: a dashboard column. */
  wide: "max-w-[1040px]",
  /** A form-like flow: Import statements, freeform import. */
  narrow: "max-w-[872px]",
} as const;

/**
 * The frame of dbu6's everyday screens: no header bar, the title at the top
 * of a scrolling, centred column. The header clears the shell's content-side
 * sidebar toggle through the same variable Sapporta's PageHeader reads.
 */
export function Screen({
  width,
  header,
  children,
}: {
  width: keyof typeof WIDTH;
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex-1 overflow-y-auto bg-sap-surface">
      <div
        className={cn(
          "mx-auto px-5 py-8 sm:px-8 sm:py-10 lg:px-14",
          WIDTH[width],
        )}
      >
        <header className="[padding-left:var(--sap-page-header-inset,0px)]">
          {header}
        </header>
        {children}
      </div>
    </div>
  );
}

/** A screen's title and the sentence or two under it. */
export function ScreenTitle({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <h1 className="text-title text-foreground">{title}</h1>
      <div className="mt-2 max-w-[700px] space-y-2 text-body text-ink-soft">
        {children}
      </div>
    </>
  );
}
