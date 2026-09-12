import { useEffect, useState } from "react";
import { LookupPicker, useTableLookup } from "@sapporta/frontend/lookup";
import type { ImportPreset } from "dbu6-shared";
import { importPresetsApi } from "../api";

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
  const [presets, setPresets] = useState<ImportPreset[]>([]);
  const accountLookup = useTableLookup("accounts");

  useEffect(() => {
    importPresetsApi
      .listImportPresets({})
      .then((body) => setPresets(body))
      .catch(() => setPresets([]));
  }, []);

  function applyPreset(p: ImportPreset) {
    const match = accounts.find((a) => a.name === p.base_account);
    if (match) onBaseAccountIdChange(String(match.id));
    onMappingsInputChange(p.custom_mappings_filenames.join(", "));
  }

  return (
    <div className="space-y-5">
      {presets.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Presets</span>
          {presets.map((p) => (
            <button
              key={p.name}
              type="button"
              disabled={disabled}
              onClick={() => applyPreset(p)}
              className="rounded-full border px-4 py-1.5 text-sm font-medium hover:bg-primary hover:text-primary-foreground hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <label
          htmlFor="account-import-base-account"
          className="text-sm font-medium"
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
        <label htmlFor="mappings" className="text-sm font-medium">
          Custom mapping files
        </label>
        <input
          id="mappings"
          type="text"
          value={mappingsInput}
          onChange={(e) => onMappingsInputChange(e.target.value)}
          disabled={disabled}
          placeholder="custom_mappings_default.prompt"
          className="block w-full rounded-md border px-3 py-1.5 text-sm font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Comma-separated. Files are resolved relative to{" "}
          <code>data/user-config/</code>.
        </p>
      </div>
    </div>
  );
}
