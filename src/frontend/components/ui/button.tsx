import * as React from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@sapporta/ui/cn";

/*
 * dbu6's button (PLAN.md §4.6). Five styles, three sizes, and a waiting
 * state. One primary button per screen.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-row font-semibold outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** Primary: the single obvious next step. */
        default:
          "bg-primary text-primary-foreground shadow-pill hover:bg-primary-hover",
        /** Secondary: "Choose files", "Collapse all", "Download". */
        outline:
          "border border-sap-border-strong bg-card text-foreground hover:bg-muted",
        /** Tertiary, reads as a link: "See the report", "Add an account". */
        ghost: "px-1 text-primary hover:underline hover:underline-offset-4",
        /** Rare: deleting a draft, removing an account. */
        destructive:
          "bg-destructive text-destructive-foreground hover:brightness-95",
        /**
         * Assist: hands a prompt to the coding agent. The only violet
         * button, and the only filled one that isn't the screen's primary.
         */
        assist:
          "bg-assist text-assist-foreground shadow-pill hover:bg-assist-hover",
      },
      // Heights follow the control tier (frontend.css, density): 44px on a
      // touch screen, 32px with a mouse.
      size: {
        /** A step above the control tier (48px or 36px): page-level actions. */
        default: "h-[calc(var(--height-sap-ctl)+4px)] px-[22px]",
        /** The control tier, the smallest click target: in-row actions. */
        sm: "h-sap-ctl px-4 text-meta",
        lg: "h-[calc(var(--height-sap-ctl)+8px)] px-7",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

/**
 * The waiting state: an action that can't run yet ("Add 21 to my books"
 * before the review is finished). Not opacity, which fails contrast; a quiet
 * fill, and always a reason underneath.
 */
const waitingClassName =
  "cursor-not-allowed bg-waiting-button-bg text-waiting-button-fg shadow-none hover:bg-waiting-button-bg";

export interface ButtonProps
  extends
    Omit<ButtonPrimitive.Props, "className">,
    VariantProps<typeof buttonVariants> {
  className?: string;
  /**
   * Why the action can't run yet, shown under the button. Setting it disables
   * the button and switches it to the waiting style.
   */
  waiting?: string;
}

export const Button = React.forwardRef<HTMLElement, ButtonProps>(
  function Button(
    { className, variant, size, waiting, disabled, ...props },
    ref,
  ) {
    // `disabled` is taken out of `props` above so a caller's value composes
    // with `waiting` instead of replacing it: waiting always disables.
    const button = (
      <ButtonPrimitive
        {...props}
        ref={ref}
        className={cn(
          buttonVariants({ variant, size }),
          waiting !== undefined && waitingClassName,
          className,
        )}
        disabled={waiting !== undefined || disabled}
      />
    );
    if (waiting === undefined) return button;
    return (
      <span className="inline-flex flex-col items-start gap-4">
        {button}
        <span className="text-meta text-ink-meta">{waiting}</span>
      </span>
    );
  },
);
