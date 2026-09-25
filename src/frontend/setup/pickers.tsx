import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Combobox, comboboxClassNames } from "@sapporta/ui/combobox";
import { cn } from "@sapporta/ui/cn";
import type { ChartChoice } from "../../shared/index";
import { knownInstitution } from "./statement-account-form";

/*
 * The banks-and-cards form's two searchable pickers, on Base UI's Combobox
 * with Sapporta's style tokens. Their items come from the step's own read
 * (the accounts of one type, the banks it knows), not from a table
 * lookup, which can't narrow the accounts to a type.
 */

function Popup({
  empty,
  children,
}: {
  empty: string;
  // A function of each item, rendering its row.
  children: Combobox.List.Props["children"];
}) {
  return (
    <Combobox.Portal>
      {/* Above the form's dialog, which sits over the popover layer. */}
      <Combobox.Positioner
        className={cn(
          comboboxClassNames.positioner,
          "z-[calc(var(--sap-z-modal-content)+1)]",
        )}
        sideOffset={4}
      >
        <Combobox.Popup className={comboboxClassNames.popup}>
          <Combobox.Empty className={comboboxClassNames.empty}>
            {empty}
          </Combobox.Empty>
          <Combobox.List className={comboboxClassNames.list}>
            {children}
          </Combobox.List>
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Portal>
  );
}

function Field({
  id,
  placeholder,
  invalid,
}: {
  id: string;
  placeholder: string;
  invalid?: boolean;
}) {
  return (
    <Combobox.InputGroup
      className={cn(comboboxClassNames.inputGroup, "bg-card")}
    >
      <Combobox.Input
        id={id}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        className={comboboxClassNames.input}
      />
      <Combobox.Trigger
        aria-label="Show the choices"
        className={cn(comboboxClassNames.action, comboboxClassNames.trigger)}
      >
        <ChevronDown />
      </Combobox.Trigger>
    </Combobox.InputGroup>
  );
}

/** One account from `choices`, by id, shown with its path in the tree. */
export function AccountCombobox({
  id,
  choices,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  id: string;
  choices: readonly ChartChoice[];
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder: string;
  invalid?: boolean;
}) {
  const selected = choices.find((choice) => choice.id === value) ?? null;
  return (
    <Combobox.Root<ChartChoice>
      items={choices}
      value={selected}
      onValueChange={(next) => onChange(next?.id ?? null)}
      itemToStringLabel={(choice) => choice.name}
      isItemEqualToValue={(a, b) => a.id === b.id}
    >
      <Field id={id} placeholder={placeholder} invalid={invalid} />
      <Popup empty="No account matches.">
        {(choice: ChartChoice) => (
          <Combobox.Item
            key={choice.id}
            value={choice}
            className={comboboxClassNames.item}
          >
            <span className="min-w-0">
              <span className="block">{choice.name}</span>
              {choice.path !== choice.name && (
                <span className="block text-meta text-ink-meta">
                  {choice.path}
                </span>
              )}
            </span>
            <Combobox.ItemIndicator
              className={comboboxClassNames.itemIndicator}
            >
              <Check />
            </Combobox.ItemIndicator>
          </Combobox.Item>
        )}
      </Popup>
    </Combobox.Root>
  );
}

// A bank the books know, or the name being typed when none has it.
interface InstitutionItem {
  name: string;
  isNew: boolean;
}

/**
 * A bank or card issuer by name: one the books know (an institution in the
 * import presets), or a new name typed in, which the server adds. Choosing
 * a known one, or typing it in another case, keeps its spelling.
 */
export function InstitutionCombobox({
  id,
  institutions,
  value,
  onChange,
  empty,
  invalid,
}: {
  id: string;
  institutions: readonly string[];
  value: string;
  onChange: (name: string) => void;
  /** What the list says before anything is typed and none is known. */
  empty: string;
  invalid?: boolean;
}) {
  const [query, setQuery] = useState(value);
  // What is typed names a known bank when only case or spaces differ.
  const typed = knownInstitution(institutions, query);
  const items: InstitutionItem[] = [
    ...institutions.map((name) => ({ name, isNew: false })),
    ...(typed !== "" && !institutions.includes(typed)
      ? [{ name: typed, isNew: true }]
      : []),
  ];
  const selected =
    value === "" ? null : { name: value, isNew: !institutions.includes(value) };
  return (
    <Combobox.Root<InstitutionItem>
      items={items}
      value={selected}
      onValueChange={(next) => onChange(next?.name ?? "")}
      inputValue={query}
      // What is typed is the institution, whether or not it is picked: the
      // known one it names, else a new one.
      onInputValueChange={(text) => {
        setQuery(text);
        onChange(knownInstitution(institutions, text));
      }}
      itemToStringLabel={(item) => item.name}
      isItemEqualToValue={(a, b) => a.name === b.name}
    >
      <Field id={id} placeholder="Search or type a name" invalid={invalid} />
      <Popup empty={empty}>
        {(item: InstitutionItem) => (
          <Combobox.Item
            key={`${item.isNew}:${item.name}`}
            value={item}
            className={comboboxClassNames.item}
          >
            {item.isNew ? <span>Add “{item.name}”</span> : item.name}
            <Combobox.ItemIndicator
              className={comboboxClassNames.itemIndicator}
            >
              <Check />
            </Combobox.ItemIndicator>
          </Combobox.Item>
        )}
      </Popup>
    </Combobox.Root>
  );
}
