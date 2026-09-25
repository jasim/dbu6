import type {
  ImportAccountView,
  ImportPresetsView,
} from "../../../shared/index";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "../../components/ui/select";

/*
 * Which account's instructions the categoriser gets on Run categorizer. An
 * import preset lists an institution's accounts, each with its own
 * instruction files; a run uses the drafts' own account's unless the user
 * picks another's, or none. The files themselves are read on Automatic
 * transaction categorization rules, not here.
 */

// The Select's value for a run without instructions.
const NO_PRESET = "";

/** A preset account, with the institution whose preset lists it. */
export interface PresetAccount {
  institution: string;
  account: ImportAccountView;
}

/** Every preset account, institution by institution. */
export function presetAccounts(presets: ImportPresetsView): PresetAccount[] {
  return presets.institutions.flatMap((institution) =>
    institution.accounts.map((account) => ({
      institution: institution.name,
      account,
    })),
  );
}

/** The preset entry of the ledger account with this id, if any lists it. */
export function accountPreset(
  presets: readonly PresetAccount[],
  accountId: number,
): PresetAccount | null {
  return presets.find((p) => p.account.account_id === accountId) ?? null;
}

/**
 * Each preset account's name, with its institution only where two accounts
 * share the name.
 */
export function presetNames(
  presets: readonly PresetAccount[],
): Map<number, string> {
  const uses = new Map<string, number>();
  for (const { account } of presets) {
    uses.set(account.name, (uses.get(account.name) ?? 0) + 1);
  }
  return new Map(
    presets.map(({ institution, account }) => [
      account.account_id,
      (uses.get(account.name) ?? 0) > 1
        ? `${account.name} · ${institution}`
        : account.name,
    ]),
  );
}

/**
 * The list of whose instructions a run uses, opened as it appears; closing
 * it, with a choice or without, is done with it.
 */
export function InstructionsChoice({
  presets,
  chosen,
  onChoose,
  onClose,
}: {
  presets: readonly PresetAccount[];
  chosen: PresetAccount | null;
  // Called with the chosen preset account's account_id, or null for none.
  onChoose: (accountId: number | null) => void;
  onClose: () => void;
}) {
  const names = presetNames(presets);
  const items: Record<string, string> = {
    ...Object.fromEntries([...names].map(([id, name]) => [String(id), name])),
    [NO_PRESET]: "None",
  };
  return (
    <Select<string>
      items={items}
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      value={chosen === null ? NO_PRESET : String(chosen.account.account_id)}
      onValueChange={(value) =>
        onChoose(value === null || value === NO_PRESET ? null : Number(value))
      }
    >
      <SelectLabel className="sr-only">Guidance</SelectLabel>
      <SelectTrigger placeholder="None" className="w-64 max-w-full" />
      <SelectContent>
        {presets.map((p) => (
          <SelectItem
            key={p.account.account_id}
            value={String(p.account.account_id)}
          >
            {names.get(p.account.account_id)}
          </SelectItem>
        ))}
        <SelectItem value={NO_PRESET}>None</SelectItem>
      </SelectContent>
    </Select>
  );
}
