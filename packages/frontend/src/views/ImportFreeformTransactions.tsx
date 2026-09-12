import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { getApiBase } from "@sapporta/frontend/platform";
import { AppPage } from "@sapporta/frontend/shell";
import {
  freeformTransactionsPrompt,
  type FreeformAccountKind,
} from "./freeform-transactions/freeformTransactionsPrompt";
import { CopyPromptButton } from "./import-statements/cards";

interface LedgerAccount {
  id: number;
  name: string;
  account_type: string;
}

// A bank account is an asset and a credit card a liability, so each kind
// lists only the ledger accounts of its type.
const KINDS: {
  kind: FreeformAccountKind;
  label: string;
  accountType: "Asset" | "Liability";
}[] = [
  { kind: "bank", label: "Bank account", accountType: "Asset" },
  { kind: "credit-card", label: "Credit card", accountType: "Liability" },
];

// The select's value before an account is chosen. Account names are never
// empty.
const NOT_CHOSEN = "";

// Freeform transactions are turned into a statement by the user's coding
// agent, not by this app, so this screen has nothing to upload: it collects
// the kind of account and the ledger account, and hands over the prompt.
export function ImportFreeformTransactions() {
  const [ledgerAccounts, setLedgerAccounts] = useState<LedgerAccount[]>([]);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [kind, setKind] = useState<FreeformAccountKind | null>(null);
  const [accountName, setAccountName] = useState(NOT_CHOSEN);

  useEffect(() => {
    fetch(`${getApiBase()}/tables/accounts?limit=1000&sort=name`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((body: { data: LedgerAccount[] }) => setLedgerAccounts(body.data))
      .catch((err) =>
        setAccountsError(
          err instanceof Error ? err.message : "Could not load accounts",
        ),
      );
  }, []);

  const accountType = KINDS.find((option) => option.kind === kind)?.accountType;
  const accounts = ledgerAccounts.filter(
    (account) => account.account_type === accountType,
  );
  const prompt =
    kind === null || accountName === NOT_CHOSEN
      ? null
      : freeformTransactionsPrompt({ kind, name: accountName });

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
          <Step number={1} title="Which account are they from?">
            <div className="grid gap-3 sm:grid-cols-2">
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">Kind</legend>
                <div className="flex gap-4 py-2">
                  {KINDS.map((option) => (
                    <label
                      key={option.kind}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="radio"
                        name="freeform-account-kind"
                        value={option.kind}
                        checked={kind === option.kind}
                        onChange={() => {
                          setKind(option.kind);
                          setAccountName(NOT_CHOSEN);
                        }}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="space-y-1">
                <label
                  htmlFor="freeform-account"
                  className="text-sm font-medium"
                >
                  Account
                </label>
                <select
                  id="freeform-account"
                  value={accountName}
                  disabled={kind === null}
                  onChange={(event) => setAccountName(event.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
                >
                  <option value={NOT_CHOSEN} disabled>
                    {kind === null
                      ? "Choose the kind first"
                      : "Choose an account…"}
                  </option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.name}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {accountsError && (
              <p className="text-xs text-destructive">
                Could not load your accounts: {accountsError}
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
                Choose the kind and the account to see the prompt.
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
