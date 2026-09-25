import { Menu } from "@base-ui/react/menu";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@sapporta/ui/cn";
import { comboboxClassNames } from "@sapporta/ui/combobox";

/**
 * A Settings table row's "⋯" menu: Edit, when the row can be edited, and
 * Remove.
 */
export function RowMenu({
  name,
  onEdit,
  onRemove,
}: {
  /** The row's name, for the button's label. */
  name: string;
  onEdit: (() => void) | null;
  onRemove: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Actions for ${name}`}
        className="inline-flex h-sap-ctl w-[var(--height-sap-ctl)] items-center justify-center rounded-control text-ink-soft outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 data-popup-open:bg-muted [&_svg]:size-4"
      >
        <MoreHorizontal />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className={comboboxClassNames.positioner}
          align="end"
          sideOffset={4}
        >
          <Menu.Popup
            className={cn(comboboxClassNames.popup, "w-auto min-w-32 p-1")}
          >
            {onEdit && (
              <Menu.Item className={comboboxClassNames.item} onClick={onEdit}>
                Edit
              </Menu.Item>
            )}
            <Menu.Item className={comboboxClassNames.item} onClick={onRemove}>
              Remove
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
