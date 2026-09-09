import { useEffect, useState } from "react";
import { LookupPicker, useTableLookup } from "@sapporta/frontend/lookup";
import type { ExtractionTool } from "dbu6-shared";
import { importPresetsApi } from "../api";

const EXTRACTION_TOOL_OPTIONS: {
  value: ExtractionTool;
  label: string;
  hint: string;
}[] = [
  {
    value: "extract-table",
    label: "extract-table",
    hint: "Run the custom table extractor for PDF statements.",
  },
  {
    value: "pdftotext",
    label: "pdftotext",
    hint: "Run pdftotext -layout for PDF statements.",
  },
];

export interface ImportPreset {
  name: string;
  base_account: string;
  custom_mappings_filenames: string[];
  is_credit_card?: boolean;
  extraction_tool?: ExtractionTool;
  custom_statement_parser_path?: string;
}

interface Account {
  id: number;
  name: string;
}

interface Props {
  accounts: Account[];
  baseAccountId: string | null;
  onBaseAccountIdChange: (id: string | null) => void;
  isCreditCard?: boolean;
  onIsCreditCardChange?: (value: boolean) => void;
  extractionTool?: ExtractionTool;
  onExtractionToolChange?: (value: ExtractionTool) => void;
  mappingsInput: string;
  onMappingsInputChange: (value: string) => void;
  onPresetApplied?: (preset: ImportPreset) => void;
  disabled?: boolean;
}

export function AccountImportInputs({
  accounts,
  baseAccountId,
  onBaseAccountIdChange,
  isCreditCard,
  onIsCreditCardChange,
  extractionTool,
  onExtractionToolChange,
  mappingsInput,
  onMappingsInputChange,
  onPresetApplied,
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
    onIsCreditCardChange?.(p.is_credit_card ?? false);
    onExtractionToolChange?.(p.extraction_tool ?? "extract-table");
    onPresetApplied?.(p);
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

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
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
        {onIsCreditCardChange && (
          <label className="flex items-center gap-2 pb-2 text-sm whitespace-nowrap">
            <input
              type="checkbox"
              checked={isCreditCard ?? false}
              disabled={disabled}
              onChange={(e) => onIsCreditCardChange(e.target.checked)}
            />
            Credit card
          </label>
        )}
      </div>

      {onExtractionToolChange && (
        <div className="space-y-1.5">
          <label className="block text-sm font-medium">
            PDF extraction tool
          </label>
          <div className="inline-flex overflow-hidden rounded-md border text-sm">
            {EXTRACTION_TOOL_OPTIONS.map(({ value, label, hint }) => {
              const active = (extractionTool ?? "extract-table") === value;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={disabled}
                  title={hint}
                  onClick={() => onExtractionToolChange(value)}
                  className={`border-r px-3 py-1.5 font-medium last:border-r-0 disabled:opacity-50 disabled:cursor-not-allowed ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-nested"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
