import type { ComponentProps } from "react";
import { accountPathName } from "dbu6-shared";
import { cn } from "@sapporta/ui/cn";
import { categoryHue, categoryHueColor } from "./category";

/**
 * A category as the everyday screens show it: a dot in its top-level
 * group's hue, then the friendly name. The colon path goes only into the
 * tooltip and the accessible name.
 */
export function CategoryLabel({
  path,
  className,
}: {
  /** The account path, such as `expenses:food:food-delivery`. */
  path: string;
  className?: string;
}) {
  return (
    <span
      title={path}
      aria-label={`${accountPathName(path)} (${path})`}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-sap-border bg-category-bg py-[5px] pl-[10px] pr-[13px] text-[15px] text-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="size-[9px] shrink-0 rounded-full"
        style={{ background: categoryHueColor(categoryHue(path)) }}
      />
      {accountPathName(path)}
    </span>
  );
}

/**
 * The empty state of a category, the thing the user is here to fix. Blue,
 * because it needs them; clicking it opens the category picker.
 */
export function NeedsCategory({
  className,
  children = "Choose a category",
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center rounded-full border border-dashed border-attention-border bg-attention-bg px-[14px] py-[6px] text-[15px] font-semibold text-attention-ink transition-colors duration-150 hover:bg-attention-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
