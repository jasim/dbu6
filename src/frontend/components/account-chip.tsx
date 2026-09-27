import type { ComponentProps } from "react";
import { cn } from "@sapporta/ui/cn";
import { accountHueColor, type AccountHueKey } from "./account-hue";

/**
 * A draft's account as the everyday screens show it: a dot in its hue, then the
 * account's name.
 */
export function AccountChip({
  name,
  hue,
  className,
}: {
  /** The account's name, such as "Food Delivery". */
  name: string;
  /** Its colour through the account tree (`accountHue`). */
  hue: AccountHueKey;
  className?: string;
}) {
  return (
    <span
      title={name}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-sap-border bg-account-chip-bg py-[5px] pl-[10px] pr-[13px] text-[13px] text-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="size-[9px] shrink-0 rounded-full"
        style={{ background: accountHueColor(hue) }}
      />
      {name}
    </span>
  );
}

/**
 * A draft with no account yet, the thing the user is here to fix. Blue,
 * because it needs them; clicking it opens the account picker.
 */
export function NeedsAccount({
  className,
  children = "Choose an account",
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center rounded-full border border-dashed border-attention-border bg-attention-bg px-[14px] py-[6px] text-[13px] font-semibold text-attention-ink transition-colors duration-150 hover:bg-attention-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
