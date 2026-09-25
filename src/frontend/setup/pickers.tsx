import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Combobox, comboboxClassNames } from "@sapporta/ui/combobox";
import { cn } from "@sapporta/ui/cn";
import type { ChartChoice } from "../../shared/index";

/*
 * The banks-and-cards form's two searchable pickers, on Base UI's Combobox
 * with Sapporta's style tokens. Their items come from the step's own read
 * (the accounts of one type, the preset institutions), not from a table
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
      <Combobox.Positioner
        className={comboboxClassNames.positioner}
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

// A preset institution, or the name being typed when no institution has it.
interface InstitutionItem {
  name: string;
  isNew: boolean;
}

/**
 * An institution by name: one the presets hold, or a new name typed in,
 * which the server adds with no parsers. Choosing a known one keeps its
 * spelling.
 */
export function InstitutionCombobox({
  id,
  institutions,
  value,
  onChange,
  invalid,
}: {
  id: string;
  institutions: readonly string[];
  value: string;
  onChange: (name: string) => void;
  invalid?: boolean;
}) {
  const [query, setQuery] = useState(value);
  const typed = query.trim();
  const known = (name: string) =>
    institutions.some((one) => one.toLowerCase() === name.toLowerCase());
  const items: InstitutionItem[] = [
    ...institutions.map((name) => ({ name, isNew: false })),
    ...(typed !== "" && !known(typed) ? [{ name: typed, isNew: true }] : []),
  ];
  const selected =
    value === "" ? null : { name: value, isNew: !institutions.includes(value) };
  return (
    <Combobox.Root<InstitutionItem>
      items={items}
      value={selected}
      onValueChange={(next) => onChange(next?.name ?? "")}
      inputValue={query}
      // What is typed is the institution, whether or not it is picked.
      onInputValueChange={(text) => {
        setQuery(text);
        onChange(text.trim());
      }}
      itemToStringLabel={(item) => item.name}
      isItemEqualToValue={(a, b) => a.name === b.name}
    >
      <Field
        id={id}
        placeholder="Your bank, or the company that issues your card"
        invalid={invalid}
      />
      <Popup empty="Type the bank's name.">
        {(item: InstitutionItem) => (
          <Combobox.Item
            key={`${item.isNew}:${item.name}`}
            value={item}
            className={comboboxClassNames.item}
          >
            {item.isNew ? (
              <span>
                Add <span className="font-semibold">{item.name}</span>
              </span>
            ) : (
              item.name
            )}
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
