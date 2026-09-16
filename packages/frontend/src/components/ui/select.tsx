import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cn } from "@sapporta/ui/cn";

/*
 * A select on Base UI (PLAN.md D5): a 44px trigger drawn like dbu6's outline
 * controls, and a floating list on the elevation token. For short lists; a
 * long one wants a searchable combobox.
 */

export const Select = SelectPrimitive.Root;

export function SelectLabel({
  className,
  ...props
}: Omit<SelectPrimitive.Label.Props, "className"> & { className?: string }) {
  return (
    <SelectPrimitive.Label
      {...props}
      className={cn("text-row font-semibold text-foreground", className)}
    />
  );
}

/**
 * The trigger's look. A control beside a select that opens something else
 * (a calendar) wears it too, so the pair reads as one set.
 */
export const selectTriggerClassName =
  "flex h-11 w-full min-w-0 items-center justify-between gap-3 rounded-control border border-sap-border-strong bg-card px-3.5 text-left text-row text-foreground outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 data-popup-open:bg-muted data-disabled:cursor-not-allowed data-disabled:border-waiting-border data-disabled:bg-waiting-bg data-disabled:text-waiting-fg";

export function SelectTrigger({
  className,
  placeholder,
  ...props
}: Omit<SelectPrimitive.Trigger.Props, "className" | "children"> & {
  className?: string;
  /** Shown while nothing is chosen. */
  placeholder: string;
}) {
  return (
    <SelectPrimitive.Trigger
      {...props}
      className={cn(selectTriggerClassName, className)}
    >
      <SelectPrimitive.Value
        placeholder={placeholder}
        className="min-w-0 truncate data-placeholder:text-ink-meta"
      />
      <SelectPrimitive.Icon
        aria-hidden="true"
        className="shrink-0 text-ink-meta"
      >
        ▾
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  ...props
}: Omit<SelectPrimitive.Popup.Props, "className"> & { className?: string }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        alignItemWithTrigger={false}
        align="start"
        sideOffset={6}
        className="z-[var(--sap-z-popover)] outline-none"
      >
        <SelectPrimitive.Popup
          {...props}
          className={cn(
            "min-w-[var(--anchor-width)] max-w-[var(--available-width)] rounded-control border border-sap-border bg-popover text-foreground shadow-sap-elevated outline-none",
            className,
          )}
        >
          <SelectPrimitive.List className="max-h-[min(var(--available-height),360px)] overflow-y-auto p-1">
            {children}
          </SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: Omit<SelectPrimitive.Item.Props, "className"> & { className?: string }) {
  return (
    <SelectPrimitive.Item
      {...props}
      className={cn(
        "grid min-h-11 cursor-default select-none grid-cols-[1.25rem_1fr] items-center gap-2 rounded-[7px] py-2 pl-2.5 pr-4 text-row text-foreground outline-none data-disabled:text-ink-meta data-highlighted:bg-muted",
        className,
      )}
    >
      <SelectPrimitive.ItemIndicator
        aria-hidden="true"
        className="col-start-1 text-primary"
      >
        ✓
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText className="col-start-2 min-w-0 [overflow-wrap:anywhere]">
        {children}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
