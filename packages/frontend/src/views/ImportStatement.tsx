import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";
import { getApiBase } from "@sapporta/frontend/platform";
import { AppPage } from "@sapporta/frontend/shell";
import type { ExtractionTool } from "dbu6-shared";
import { AccountImportInputs, type ImportPreset } from "./AccountImportInputs";
import { MarkdownGuide } from "../components/MarkdownGuide";
import parserGuideMarkdown from "../../../../custom-built-parsers/import-statement-parser-guide.md?raw";

interface Account {
  id: number;
  name: string;
}

interface ImportResult {
  hledger_journal: string;
  transaction_count: number;
  skipped_reconciled_count: number;
  draft_transaction_count: number;
  duplicate_count: number;
  draft_duplicate_count: number;
  journal_duplicate_count: number;
  legacy_match_count: number;
  backfilled_count: number;
  gpay_enriched_count: number;
  opening_balance: number | null;
  closing_balance_from_statement: number | null;
  custom_statement_parser_paths?: string[];
  balance_metadata: {
    opening: BalanceMetadata;
    closing: BalanceMetadata;
  };
  warnings: string[];
}

interface BalanceMetadata {
  extracted: number | null;
  effective: number | null;
  source: "manual" | "statement" | "checkpoint" | "per-row" | "none";
}

export function ImportStatement() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [gpayFile, setGpayFile] = useState<File | null>(null);
  const [baseAccountId, setBaseAccountId] = useState<string | null>(null);
  const [isCreditCard, setIsCreditCard] = useState(false);
  const [extractionTool, setExtractionTool] =
    useState<ExtractionTool>("extract-table");
  const [mappingsInput, setMappingsInput] = useState("");
  const [customParserPath, setCustomParserPath] = useState<string | null>(null);
  const [presetAccountIdentifier, setPresetAccountIdentifier] = useState<
    string | null
  >(null);
  const [useCustomParser, setUseCustomParser] = useState(false);
  const [autoDetectCustomParser, setAutoDetectCustomParser] = useState(false);
  const [manualOpeningBalance, setManualOpeningBalance] = useState("");
  const [manualClosingBalance, setManualClosingBalance] = useState("");
  const [balanceOverridesOpen, setBalanceOverridesOpen] = useState(false);
  const [closingBalanceRequired, setClosingBalanceRequired] = useState(false);
  const closingBalanceRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${getApiBase()}/tables/accounts?limit=1000&sort=name`)
      .then((r) => r.json())
      .then((body: { data: Account[] }) => setAccounts(body.data))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load accounts"),
      );
  }, []);

  async function handleSubmit() {
    if (files.length === 0 || baseAccountId === null) return;
    const account = accounts.find((a) => String(a.id) === baseAccountId);
    if (!account) return;

    setLoading(true);
    setError(null);
    setErrorHint(null);
    setClosingBalanceRequired(false);
    setResult(null);

    const form = new FormData();
    for (const f of files) form.append("files", f);
    if (gpayFile) form.append("gpay", gpayFile);
    form.append("base_account", account.name);
    if (isCreditCard) form.append("is_credit_card", "true");
    form.append("extraction_tool", extractionTool);
    if (mappingsInput.trim()) {
      form.append("custom_mappings_filenames", mappingsInput.trim());
    }
    if (showAutoDetectParserToggle && autoDetectCustomParser) {
      form.append("auto_detect_statement_parser", "true");
    } else if (showCustomParserToggle && useCustomParser && customParserPath) {
      form.append("custom_statement_parser_path", customParserPath);
    }
    if (presetAccountIdentifier !== null) {
      form.append("statement_account_identifier", presetAccountIdentifier);
    }
    if (manualOpeningBalance.trim() !== "") {
      form.append("manual_opening_balance", manualOpeningBalance.trim());
    }
    if (manualClosingBalance.trim() !== "") {
      form.append("manual_closing_balance", manualClosingBalance.trim());
    }

    try {
      const res = await fetch(`${getApiBase()}/import-draft/statement/upload`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const errorCode =
          body && typeof body === "object" && "error" in body
            ? String((body as { error: unknown }).error)
            : null;
        const msg =
          body && typeof body === "object" && "error" in body
            ? `${String((body as { error: unknown }).error)}${
                "message" in body
                  ? `: ${String((body as { message: unknown }).message)}`
                  : ""
              }`
            : `HTTP ${res.status}`;
        const hint =
          body &&
          typeof body === "object" &&
          (("hint" in body &&
            typeof (body as { hint: unknown }).hint === "string") ||
            ("detail" in body &&
              typeof (body as { detail: unknown }).detail === "string"))
            ? "hint" in body &&
              typeof (body as { hint: unknown }).hint === "string"
              ? (body as { hint: string }).hint
              : (body as { detail: string }).detail
            : null;
        setErrorHint(hint);
        if (errorCode === "closing_balance_unavailable") {
          setClosingBalanceRequired(true);
          setBalanceOverridesOpen(true);
          requestAnimationFrame(() => closingBalanceRef.current?.focus());
        }
        throw new Error(msg);
      }
      setResult((await res.json()) as ImportResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  function handleBaseAccountIdChange(id: string | null) {
    setBaseAccountId(id);
    setCustomParserPath(null);
    setUseCustomParser(false);
    setPresetAccountIdentifier(null);
  }

  function handlePresetApplied(preset: ImportPreset) {
    const parserPath = preset.custom_statement_parser_path ?? null;
    setCustomParserPath(parserPath);
    setUseCustomParser(parserPath !== null);
    setAutoDetectCustomParser(false);
    setPresetAccountIdentifier(preset.statement_account_identifier ?? null);
  }

  const hasJsonFile = files.some((f) => f.name.toLowerCase().endsWith(".json"));
  const showCustomParserToggle = files.length > 0 && customParserPath !== null;
  const showAutoDetectParserToggle = files.length > 0 && !hasJsonFile;
  const canSubmit = files.length > 0 && baseAccountId !== null && !loading;

  return (
    <AppPage section="Import" title="Import a statement">
      <div className="p-8 max-w-2xl space-y-8">
        <div>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              Upload a bank or credit card statement, then choose the account it
              belongs to. PDF, text, CSV, XLS, and Abacus JSON files are
              supported. A Google Pay Takeout export can be attached to any
              import to name the recipients of UPI payments.
            </p>
            <p>
              Imported transactions stay in Draft entries until you review their
              categories, duplicates, and balances. This step does not change
              the posted books.
            </p>
          </div>
          <MarkdownGuide markdown={parserGuideMarkdown} />
        </div>

        <div className="space-y-4 rounded-md border p-4">
          <label className="text-sm font-medium">Statement files</label>
          <input
            type="file"
            accept=".pdf,.txt,.csv,.xls,.json"
            multiple
            disabled={loading}
            onChange={(e) => {
              const selectedFiles = e.target.files
                ? Array.from(e.target.files)
                : [];
              setFiles(selectedFiles);
              if (
                selectedFiles.some((file) =>
                  file.name.toLowerCase().endsWith(".json"),
                )
              ) {
                setAutoDetectCustomParser(false);
              }
              setResult(null);
              setError(null);
            }}
            className="block w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer"
          />
          {files.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2">
                  <span className="font-mono">{f.name}</span>
                  <span>({Math.round(f.size / 1024)} KB)</span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    disabled={loading}
                    onClick={() =>
                      setFiles((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    className="opacity-60 hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-1">
            <label htmlFor="gpay-takeout-file" className="text-sm font-medium">
              Google Pay Takeout (optional)
            </label>
            <input
              id="gpay-takeout-file"
              type="file"
              accept=".html,.htm"
              disabled={loading}
              aria-describedby="gpay-takeout-help"
              onChange={(e) => {
                setGpayFile(e.target.files?.[0] ?? null);
                setResult(null);
                setError(null);
              }}
              className="block w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer"
            />
            <p id="gpay-takeout-help" className="text-xs text-muted-foreground">
              The Takeout HTML prefixes matching UPI withdrawals with the
              recipient's name before categorization. It never changes which
              transactions are treated as duplicates.
            </p>
            {gpayFile && (
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">{gpayFile.name}</span> (
                {Math.round(gpayFile.size / 1024)} KB)
              </p>
            )}
          </div>

          <AccountImportInputs
            accounts={accounts}
            baseAccountId={baseAccountId}
            onBaseAccountIdChange={handleBaseAccountIdChange}
            isCreditCard={isCreditCard}
            onIsCreditCardChange={setIsCreditCard}
            extractionTool={extractionTool}
            onExtractionToolChange={setExtractionTool}
            mappingsInput={mappingsInput}
            onMappingsInputChange={setMappingsInput}
            onPresetApplied={handlePresetApplied}
            disabled={loading}
          />

          {showAutoDetectParserToggle && (
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                checked={autoDetectCustomParser}
                disabled={loading}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setAutoDetectCustomParser(checked);
                  if (checked) setUseCustomParser(false);
                }}
                className="mt-0.5"
              />
              <span className="space-y-1">
                <span className="block font-medium">
                  Auto-detect a saved deterministic parser
                </span>
                <span className="block text-xs text-muted-foreground">
                  Try each saved parser with a fingerprint and require exactly
                  one match. The import stops on no match or an ambiguous match;
                  it does not fall back to AI extraction.
                </span>
              </span>
            </label>
          )}

          {showCustomParserToggle && (
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                checked={useCustomParser}
                disabled={loading}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setUseCustomParser(checked);
                  if (checked) setAutoDetectCustomParser(false);
                }}
                className="mt-0.5"
              />
              <span className="space-y-1">
                <span className="block font-medium">
                  Use {customParserPath} parser
                </span>
                <span className="block text-xs text-muted-foreground">
                  When enabled, the upload uses this preset parser to create
                  Abacus JSON before importing drafts.
                </span>
              </span>
            </label>
          )}

          <details
            open={balanceOverridesOpen}
            onToggle={(event) =>
              setBalanceOverridesOpen(event.currentTarget.open)
            }
            className="rounded-md border p-3"
          >
            <summary className="cursor-pointer text-sm font-medium">
              Balance overrides
            </summary>
            <div className="mt-3 space-y-3">
              <p
                id="balance-overrides-help"
                className="text-xs text-muted-foreground"
              >
                {isCreditCard
                  ? "Enter the positive amount printed by the bank. The importer records it once as a negative card liability."
                  : "Enter balances in the printed ledger direction."}{" "}
                {files.length > 1
                  ? "Opening applies to the earliest statement; closing applies to the latest."
                  : "Manual values override extracted statement values."}
              </p>
              {hasJsonFile && isCreditCard && (
                <p className="text-xs text-muted-foreground">
                  Abacus JSON rows remain in ledger semantics; only these manual
                  printed balance inputs are converted to card-liability signs.
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label
                    htmlFor="manual-opening-balance"
                    className="text-xs font-medium"
                  >
                    Statement opening
                  </label>
                  <input
                    id="manual-opening-balance"
                    inputMode="decimal"
                    value={manualOpeningBalance}
                    disabled={loading}
                    aria-describedby="balance-overrides-help"
                    onChange={(event) =>
                      setManualOpeningBalance(event.target.value)
                    }
                    placeholder="Optional"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="manual-closing-balance"
                    className="text-xs font-medium"
                  >
                    Statement closing
                  </label>
                  <input
                    ref={closingBalanceRef}
                    id="manual-closing-balance"
                    inputMode="decimal"
                    value={manualClosingBalance}
                    disabled={loading}
                    aria-describedby={
                      closingBalanceRequired
                        ? "balance-overrides-help closing-balance-error"
                        : "balance-overrides-help"
                    }
                    aria-invalid={closingBalanceRequired || undefined}
                    onChange={(event) => {
                      setManualClosingBalance(event.target.value);
                      setClosingBalanceRequired(false);
                    }}
                    placeholder="Optional"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                  {closingBalanceRequired && (
                    <p
                      id="closing-balance-error"
                      className="text-xs text-destructive"
                    >
                      Enter the printed closing amount, then retry with the same
                      selected files.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </details>

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "Importing..." : "Import"}
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
            <div className="space-y-2">
              <div className="text-sm font-medium text-destructive">
                Import failed
              </div>
              <div className="text-sm text-destructive/80 break-words">
                {error}
              </div>
              {errorHint && (
                <div className="text-sm text-foreground/80 break-words border-t border-destructive/30 pt-2">
                  {errorHint}
                </div>
              )}
            </div>
          </div>
        )}

        {result && (
          <ImportResultPanel result={result} isCreditCard={isCreditCard} />
        )}
      </div>
    </AppPage>
  );
}

function ImportResultPanel({
  result,
  isCreditCard,
}: {
  result: ImportResult;
  isCreditCard: boolean;
}) {
  const parserPaths = Array.from(
    new Set(result.custom_statement_parser_paths ?? []),
  );
  const balanceDelta =
    result.balance_metadata.opening.effective !== null &&
    result.balance_metadata.closing.effective !== null
      ? result.balance_metadata.closing.effective -
        result.balance_metadata.opening.effective
      : null;

  return (
    <div className="rounded-md border divide-y">
      <div className="flex items-center gap-2 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 text-green-600" />
        <div className="min-w-0">
          <div className="text-sm font-medium">Import complete</div>
          {parserPaths.length > 0 && (
            <div className="mt-0.5 text-xs text-muted-foreground break-all">
              Deterministic parser{parserPaths.length === 1 ? "" : "s"}:{" "}
              {parserPaths.join(", ")}
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-4 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Drafts created
          </div>
          <div className="text-4xl font-semibold tabular-nums">
            {result.draft_transaction_count}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Parsed</dt>
            <dd className="font-medium tabular-nums">
              {result.transaction_count}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Duplicates skipped</dt>
            <dd className="font-medium tabular-nums">
              {result.duplicate_count}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Past reconciliation</dt>
            <dd className="font-medium tabular-nums">
              {result.skipped_reconciled_count}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Backfilled</dt>
            <dd className="font-medium tabular-nums">
              {result.backfilled_count}
            </dd>
          </div>
          {result.gpay_enriched_count > 0 && (
            <div>
              <dt className="text-muted-foreground">GPay enriched</dt>
              <dd className="font-medium tabular-nums">
                {result.gpay_enriched_count}
              </dd>
            </div>
          )}
        </dl>
      </div>

      <div className="px-4 py-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
          Balance check
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <BalanceResult
            label="Opening"
            value={result.balance_metadata.opening}
            isCreditCard={isCreditCard}
          />
          <BalanceResult
            label="Closing"
            value={result.balance_metadata.closing}
            isCreditCard={isCreditCard}
          />
        </div>
        <div className="mt-2 text-xs tabular-nums">
          {balanceDelta !== null && (
            <span
              className={`text-xs ${
                balanceDelta >= 0 ? "text-green-600" : "text-destructive"
              }`}
            >
              ({balanceDelta >= 0 ? "+" : ""}
              {balanceDelta.toLocaleString()})
            </span>
          )}
        </div>
        {result.warnings.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-amber-700 dark:text-amber-400">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </div>

      <details className="px-4 py-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Show hledger journal
        </summary>
        <pre className="mt-2 p-3 bg-nested rounded overflow-x-auto whitespace-pre font-mono">
          {result.hledger_journal}
        </pre>
      </details>
    </div>
  );
}

function BalanceResult({
  label,
  value,
  isCreditCard,
}: {
  label: string;
  value: BalanceMetadata;
  isCreditCard: boolean;
}) {
  return (
    <div className="rounded-md bg-nested p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide">
          {value.source}
        </span>
      </div>
      <div className="mt-1 font-semibold tabular-nums">
        {formatBalance(value.effective, isCreditCard)}
      </div>
      <div className="mt-1 text-xs text-muted-foreground tabular-nums">
        Extracted: {formatBalance(value.extracted, isCreditCard)}
      </div>
    </div>
  );
}

function formatBalance(value: number | null, isCreditCard: boolean): string {
  if (value === null) return "-";
  const ledger = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(value);
  if (!isCreditCard || value >= 0) return ledger;
  const owed = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(Math.abs(value));
  return `${owed} owed (ledger ${ledger})`;
}
