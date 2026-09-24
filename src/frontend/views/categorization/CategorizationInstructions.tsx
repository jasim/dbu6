import { useEffect, useState } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { cn } from "@sapporta/ui/cn";
import type {
  CustomMappingsFile,
  ImportAccountView,
  ImportPresetsView,
} from "../../../shared/index";
import { importPresetsApi } from "../../api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "../../components/ui/select";

/*
 * What the coding agent is told when it categorizes, on Classify drafts. An
 * import preset lists an institution's accounts, each with its own
 * instruction files; here only those files matter, so the user picks the
 * preset account whose instructions to use (the drafts' own account, unless
 * they want another's) and reads them, each file on a tab of its own.
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

/** "Sample Bank · Sample Savings". */
function presetLabel({ institution, account }: PresetAccount): string {
  return `${institution} · ${account.name}`;
}

interface Props {
  presets: readonly PresetAccount[];
  // The ledger account whose drafts are classified.
  accountId: number;
  // Its name; undefined while it loads.
  accountName: string | undefined;
  // The preset account whose instructions a run sends, or null for none.
  chosen: PresetAccount | null;
  // Called with the chosen preset account's account_id, or null for none.
  onChoose: (accountId: number | null) => void;
  disabled?: boolean;
}

export function CategorizationInstructions({
  presets,
  accountId,
  accountName,
  chosen,
  onChoose,
  disabled,
}: Props) {
  const own = accountPreset(presets, accountId);
  const items: Record<string, string> = {
    [NO_PRESET]: "No instructions",
    ...Object.fromEntries(
      presets.map((p) => [String(p.account.account_id), presetLabel(p)]),
    ),
  };

  return (
    <section aria-labelledby="instructions-heading" className="space-y-3">
      <div className="space-y-1">
        <h2
          id="instructions-heading"
          className="text-row font-semibold text-foreground"
        >
          Instructions for the coding agent
        </h2>
        <p className="text-meta text-ink-meta">
          Your mapping rules go first. The coding agent gets the drafts they
          don't match, with these instructions.
        </p>
      </div>

      <Select<string>
        items={items}
        value={chosen === null ? NO_PRESET : String(chosen.account.account_id)}
        onValueChange={(value) =>
          onChoose(value === null || value === NO_PRESET ? null : Number(value))
        }
        disabled={disabled}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <SelectLabel className="text-meta font-medium text-ink-soft">
            From preset
          </SelectLabel>
          <SelectTrigger placeholder="No instructions" className="w-72" />
          {accountName !== undefined && (
            <span className="text-meta text-ink-meta">
              {own === null
                ? `${accountName} is in no import preset.`
                : chosen?.account.account_id === own.account.account_id
                  ? `The instructions ${accountName} imports with.`
                  : `${accountName} imports with ${presetLabel(own)}.`}
            </span>
          )}
        </div>
        <SelectContent>
          {presets.map((p) => (
            <SelectItem
              key={p.account.account_id}
              value={String(p.account.account_id)}
            >
              {presetLabel(p)}
            </SelectItem>
          ))}
          <SelectItem value={NO_PRESET}>No instructions</SelectItem>
        </SelectContent>
      </Select>

      {chosen === null ? (
        <p className="rounded-control border border-dashed px-3 py-2 text-meta text-ink-meta">
          The coding agent will categorize from your account names alone.
        </p>
      ) : chosen.account.custom_mappings_filenames.length === 0 ? (
        <p className="rounded-control border border-dashed px-3 py-2 text-meta text-ink-meta">
          {presetLabel(chosen)} names no instruction files, so the coding agent
          will categorize from your account names alone.
        </p>
      ) : (
        <InstructionFiles
          // Another account's instructions open on their first file.
          key={chosen.account.account_id}
          filenames={chosen.account.custom_mappings_filenames}
        />
      )}
    </section>
  );
}

/** A preset account's instruction files, one tab each, read-only. */
function InstructionFiles({ filenames }: { filenames: readonly string[] }) {
  return (
    <Tabs.Root
      defaultValue={filenames[0]}
      className="overflow-hidden rounded-control border"
    >
      <Tabs.List className="flex gap-5 overflow-x-auto overflow-y-hidden border-b bg-muted px-3">
        {filenames.map((filename) => (
          <Tabs.Tab
            key={filename}
            value={filename}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 border-transparent py-2 font-mono text-meta text-ink-meta outline-none transition-colors duration-150 hover:text-foreground focus-visible:text-foreground focus-visible:underline",
              "data-active:border-foreground data-active:text-foreground",
            )}
          >
            {filename}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {filenames.map((filename) => (
        <Tabs.Panel key={filename} value={filename}>
          <InstructionFile filename={filename} />
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}

type Loaded =
  | { state: "loading" }
  | { state: "loaded"; file: CustomMappingsFile }
  | { state: "failed"; message: string };

function InstructionFile({ filename }: { filename: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });

  useEffect(() => {
    let current = true;
    setLoaded({ state: "loading" });
    importPresetsApi
      .readCustomMappingsFile({ params: { filename } })
      .then((file) => current && setLoaded({ state: "loaded", file }))
      .catch(
        (e) =>
          current &&
          setLoaded({
            state: "failed",
            message: e instanceof Error ? e.message : "Couldn't read it",
          }),
      );
    return () => {
      current = false;
    };
  }, [filename]);

  const where = <code className="font-mono">user-config/{filename}</code>;
  if (loaded.state === "loading") {
    return <p className="px-3 py-3 text-meta text-ink-meta">Reading…</p>;
  }
  if (loaded.state === "failed") {
    return (
      <p className="px-3 py-3 text-meta text-destructive">
        Couldn't read {where}: {loaded.message}
      </p>
    );
  }
  if (loaded.file.content === null) {
    return (
      <p className="px-3 py-3 text-meta text-ink-meta">
        There is no {where}, so a run leaves it out.
      </p>
    );
  }
  return (
    <div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 py-3 font-mono text-meta leading-relaxed text-foreground">
        {loaded.file.content}
      </pre>
      <p className="border-t px-3 py-1.5 text-label text-ink-meta">
        Edit {where} to change it, then classify again.
      </p>
    </div>
  );
}
