import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AppPage } from "@sapporta/frontend/shell";
import type { ImportPreset } from "dbu6-shared";
import { importPresetsApi } from "../api";
import { freeformTransactionsPrompt } from "./freeform-transactions/freeformTransactionsPrompt";
import { CopyPromptButton } from "./import-statements/cards";

// Select values that are not preset names. Preset names are never empty.
const NOT_CHOSEN = "";
const NO_PRESET = " not set up";

// Freeform transactions are turned into a statement by the user's coding
// agent, not by this app, so this screen has nothing to upload: it collects
// the bank and the account and hands over the prompt.
export function ImportFreeformTransactions() {
  const [presets, setPresets] = useState<ImportPreset[]>([]);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [bankName, setBankName] = useState("");
  const [presetChoice, setPresetChoice] = useState(NOT_CHOSEN);

  useEffect(() => {
    importPresetsApi
      .listImportPresets({})
      .then(setPresets)
      .catch((err) =>
        setPresetsError(
          err instanceof Error ? err.message : "Could not load presets",
        ),
      );
  }, []);

  const preset = presets.find((p) => p.name === presetChoice) ?? null;
  const ready =
    bankName.trim() !== "" && (preset !== null || presetChoice === NO_PRESET);
  const prompt = ready
    ? freeformTransactionsPrompt({ bankName, preset })
    : null;

  return (
    <AppPage section="Import" title="Import freeform transactions">
      <div className="p-8 max-w-2xl space-y-6">
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            For transactions no saved reader can import: text copied from a PDF
            or a web page, HTML, CSV, or a list you typed yourself. Any form
            works as long as it has the transactions in it. Your coding agent
            turns them into a statement, asks you for the balances, and imports
            them into Drafts.
          </p>
          <p>
            There is nothing to upload here. Nothing changes your books until
            you post the drafts.
          </p>
        </div>

        <ol className="space-y-6">
          <Step number={1} title="Which bank and account?">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label
                  htmlFor="freeform-bank-name"
                  className="text-sm font-medium"
                >
                  Bank
                </label>
                <input
                  id="freeform-bank-name"
                  value={bankName}
                  onChange={(event) => setBankName(event.target.value)}
                  placeholder="The bank's name"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="freeform-preset"
                  className="text-sm font-medium"
                >
                  Account
                </label>
                <select
                  id="freeform-preset"
                  value={presetChoice}
                  onChange={(event) => setPresetChoice(event.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value={NOT_CHOSEN} disabled>
                    Choose an account…
                  </option>
                  {presets.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} ({p.base_account})
                    </option>
                  ))}
                  <option value={NO_PRESET}>Not set up here yet</option>
                </select>
              </div>
            </div>
            {presetsError && (
              <p className="text-xs text-destructive">
                Could not load your import presets: {presetsError}
              </p>
            )}
          </Step>

          <Step number={2} title="Give the transactions to your coding agent">
            <p className="text-sm text-muted-foreground">
              Copy this prompt into your coding agent, running in this app's
              repository, and paste the transactions right after it. The agent
              will ask for the balance just before the earliest transaction and
              just after the latest one, so have them ready.
            </p>
            {prompt === null ? (
              <p className="text-sm text-muted-foreground">
                Enter the bank and choose the account to see the prompt.
              </p>
            ) : (
              <div className="space-y-2">
                <CopyPromptButton text={prompt} />
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-nested p-3 font-mono text-xs">
                  {prompt}
                </pre>
              </div>
            )}
          </Step>

          <Step number={3} title="Review the drafts">
            <p className="text-sm text-muted-foreground">
              The agent tells you what it imported. Then check the new rows in{" "}
              <Link
                to="/tables/draft_transactions"
                className="text-primary hover:underline"
              >
                Draft entries
              </Link>
              .
            </p>
          </Step>
        </ol>
      </div>
    </AppPage>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium">
        {number}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-sm font-medium">{title}</div>
        {children}
      </div>
    </li>
  );
}
