import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { cn } from "@sapporta/ui/cn";

/*
 * A row of pill toggles on Base UI (PLAN.md D5): a few presets side by side,
 * the pressed one filled with ink, as Review's tabs are. The arrow keys move
 * between them. Label the group with `aria-label`.
 */

/**
 * The pill's look, pressed through `data-pressed`. A control beside the
 * group that opens something (a popover) wears it too, so the row reads as
 * one set.
 */
export const togglePillClassName =
  "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border border-sap-border bg-card px-4 text-[15.5px] font-semibold text-ink-soft outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 data-pressed:border-foreground data-pressed:bg-foreground data-pressed:text-background";

export interface ToggleGroupProps<Value extends string> extends Omit<
  ToggleGroupPrimitive.Props<Value>,
  "className"
> {
  className?: string;
}

export function ToggleGroup<Value extends string>({
  className,
  ...props
}: ToggleGroupProps<Value>) {
  return (
    <ToggleGroupPrimitive<Value>
      {...props}
      className={cn("flex gap-2", className)}
    />
  );
}

export interface ToggleGroupItemProps<Value extends string> extends Omit<
  Toggle.Props<Value>,
  "className"
> {
  className?: string;
}

export function ToggleGroupItem<Value extends string>({
  className,
  ...props
}: ToggleGroupItemProps<Value>) {
  return (
    <Toggle<Value> {...props} className={cn(togglePillClassName, className)} />
  );
}
