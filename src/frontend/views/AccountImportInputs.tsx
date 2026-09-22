import { useEffect, useRef, useState } from "react";
import { LookupPicker, useTableLookup } from "@sapporta/frontend/lookup";
import type { ImportPreset } from "../../shared/index";
import { importPresetsApi } from "../api";
import { Button } from "../components/ui/button";

interface Account {
  id: number;
  name: string;
}

interface Props {
  accounts: Account[];
  baseAccountId: string | null;
  onBaseAccountIdChange: (id: string | null) => void;
  mappingsInput: string;
  onMappingsInputChange: (value: string) => void;
  disabled?: boolean;
}

export function AccountImportInputs({
  accounts,
  baseAccountId,
  onBaseAccountIdChange,
  mappingsInput,
  onMappingsInputChange,
  disabled,
}: Props) {
  // Null until they load.
  const [presets, setPresets] = useState<ImportPreset[] | null>(null);
  const accountLookup = useTableLookup("accounts");
  // The account whose mapping files are filled in, so each account fills
  // them once and a preset's own choice stands.
  const filledFor = useRef<string | null>(null);

  useEffect(() => {
    importPresetsApi
      .listImportPresets({})
      .then((body) => setPresets(body))
      .catch(() => setPresets([]));
  }, []);

  // A chosen account, picked or opened from its Drafts tab, gets the mapping
  // files its presets import with, so it is categorized as its imports were.
  useEffect(() => {
    if (baseAccountId === null || filledFor.current === baseAccountId) return;
    const account = accounts.find((a) => String(a.id) === baseAccountId);
    if (!account || presets === null) return;
    filledFor.current = baseAccountId;
    const filenames = new Set(
      presets
        .filter((p) => p.base_account === account.name)
        .flatMap((p) => p.custom_mappings_filenames),
    );
    onMappingsInputChange([...filenames].join(", "));
  }, [accounts, presets, baseAccountId, onMappingsInputChange]);

  function applyPreset(p: ImportPreset) {
    const match = accounts.find((a) => a.name === p.base_account);
    if (match) {
      filledFor.current = String(match.id);
      onBaseAccountIdChange(String(match.id));
    }
    onMappingsInputChange(p.custom_mappings_filenames.join(", "));
  }

  return (
    <div className="space-y-5">
      {presets && presets.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-row">
          <span className="text-ink-meta">Presets</span>
          {presets.map((p) => (
            <Button
              key={p.name}
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => applyPreset(p)}
              className="rounded-full"
            >
              {p.name}
            </Button>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <label
          htmlFor="account-import-base-account"
          className="text-row font-medium text-foreground"
        >
          Account on this statement
        </label>
        <LookupPicker
          id="account-import-base-account"
          lookup={accountLookup}
          value={baseAccountId === null ? null : Number(baseAccountId)}
          onChange={(id) =>
            onBaseAccountIdChange(id === null ? null : String(id))
          }
          placeholder="Select a bank or credit card account..."
          disabled={disabled}
          className="w-full"
        />
      </div>

      <div className="space-y-1">
        <label
          htmlFor="mappings"
          className="text-row font-medium text-foreground"
        >
          Custom mapping files
        </label>
        <input
          id="mappings"
          type="text"
          value={mappingsInput}
          onChange={(e) => onMappingsInputChange(e.target.value)}
          disabled={disabled}
          placeholder="custom_mappings_default.prompt"
          className="block w-full rounded-control border bg-card px-3 py-1.5 text-row font-mono"
        />
        <p className="text-meta text-ink-meta">
          Comma-separated. Files are resolved relative to{" "}
          <code>user-config/</code>.
        </p>
      </div>
    </div>
  );
}
