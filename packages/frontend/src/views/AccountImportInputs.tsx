import { useEffect, useState } from "react";
import { LookupPicker, useTableLookup } from "@sapporta/frontend/lookup";
import type { ImportPreset } from "dbu6-shared";
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
          <code>data/user-config/</code>.
        </p>
      </div>
    </div>
  );
}
