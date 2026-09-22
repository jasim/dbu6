import { Radio } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cn } from "@sapporta/ui/cn";

/*
 * A radio group drawn as a segmented control (PLAN.md D5): a few short,
 * mutually exclusive options side by side in a quiet track, the chosen one
 * raised as a white pill. Each option is a button with the arrow keys moving
 * between them, as radios do. Label the group with `aria-labelledby`.
 */

export interface RadioGroupProps<Value> extends Omit<
  RadioGroupPrimitive.Props<Value>,
  "className"
> {
  className?: string;
}

export function RadioGroup<Value>({
  className,
  ...props
}: RadioGroupProps<Value>) {
  return (
    <RadioGroupPrimitive<Value>
      {...props}
      className={cn(
        "flex max-w-full gap-1 rounded-control border border-sap-border bg-sap-sidebar p-1",
        className,
      )}
    />
  );
}

export interface RadioGroupItemProps<Value> extends Omit<
  Radio.Root.Props<Value>,
  "className" | "nativeButton" | "render"
> {
  className?: string;
}

export function RadioGroupItem<Value>({
  className,
  ...props
}: RadioGroupItemProps<Value>) {
  return (
    <Radio.Root<Value>
      {...props}
      nativeButton
      render={<button type="button" />}
      className={cn(
        "inline-flex h-11 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-[7px] px-4 text-row font-normal text-ink-soft outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 data-checked:bg-card data-checked:font-semibold data-checked:text-foreground data-checked:shadow-pill data-disabled:cursor-not-allowed",
        className,
      )}
    />
  );
}
