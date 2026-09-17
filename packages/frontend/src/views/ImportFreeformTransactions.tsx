import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@sapporta/frontend/platform";
import { usePageTitle } from "@sapporta/frontend/shell";
import { Screen, ScreenTitle } from "../components/screen";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "../components/ui/select";
import { LEDGER_ACCOUNT_TYPE, type AccountKind } from "dbu6-shared";
import { apiErrorMessage } from "../api";
import { FRESH_QUERY } from "../queries";
import { freeformTransactionsPrompt } from "./freeform-transactions/freeformTransactionsPrompt";
import { AgentPrompt } from "../components/agent-prompt";

interface LedgerAccount {
  id: number;
  name: string;
  account_type: string;
}

// Each kind lists only the ledger accounts of its type.
const KINDS: { kind: AccountKind; label: string }[] = [
  { kind: "bank", label: "Bank account" },
  { kind: "card", label: "Credit card" },
];

// Freeform transactions are turned into a statement by the user's coding
// agent, not by this app, so this screen has nothing to upload: it collects
// the kind of account and the ledger account, and hands over the prompt.
export function ImportFreeformTransactions() {
  usePageTitle("Import freeform transactions");
  const kindLabelId = useId();
  const accountsQuery = useQuery({
    queryKey: ["tables", "accounts"],
    queryFn: fetchLedgerAccounts,
    ...FRESH_QUERY,
  });
  const ledgerAccounts = accountsQuery.data ?? [];
  const accountsError = accountsQuery.isError
    ? apiErrorMessage(accountsQuery.error)
    : null;
  const [kind, setKind] = useState<AccountKind | null>(null);
  const [accountName, setAccountName] = useState<string | null>(null);

  const accounts =
    kind === null
      ? []
      : ledgerAccounts.filter(
          (account) => account.account_type === LEDGER_ACCOUNT_TYPE[kind],
        );
  const prompt =
    kind === null || accountName === null
      ? null
      : freeformTransactionsPrompt({ kind, name: accountName });

  return (
    <Screen
      width="narrow"
      header={
        <ScreenTitle title="Import freeform transactions">
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
        </ScreenTitle>
      }
    >
      <ol className="mt-8 space-y-8">
        <Step number={1} title="Which account are they from?">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div
                id={kindLabelId}
                className="text-row font-semibold text-foreground"
              >
                Kind
              </div>
              <RadioGroup<AccountKind | null>
                aria-labelledby={kindLabelId}
                value={kind}
                onValueChange={(value) => {
                  setKind(value);
                  setAccountName(null);
                }}
              >
                {KINDS.map((option) => (
                  <RadioGroupItem key={option.kind} value={option.kind}>
                    {option.label}
                  </RadioGroupItem>
                ))}
              </RadioGroup>
            </div>
            <Select<string>
              value={accountName}
              onValueChange={setAccountName}
              disabled={kind === null}
            >
              <div className="min-w-0 space-y-2">
                <SelectLabel className="block">Account</SelectLabel>
                <SelectTrigger
                  placeholder={
                    kind === null
                      ? "Choose the kind first"
                      : "Choose an account…"
                  }
                />
              </div>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.name}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {accountsError && (
            <p className="text-meta text-destructive">
              Could not load your accounts: {accountsError}
            </p>
          )}
        </Step>

        <Step number={2} title="Give the transactions to your coding agent">
          {prompt === null ? (
            <p className="text-meta text-ink-meta">
              Choose the kind and the account to see the prompt.
            </p>
          ) : (
            <AgentPrompt
              title="Turn your transactions into drafts"
              prompt={prompt}
            >
              Paste the transactions as your first reply in the terminal, or
              right after the prompt if you copy it. The agent asks for the
              balance just before the earliest transaction and just after the
              latest one, so have them ready.
            </AgentPrompt>
          )}
        </Step>

        <Step number={3} title="Review the drafts">
          <p className="text-row text-ink-soft">
            The agent tells you what it imported. Then check the new rows in{" "}
            <Link to="/review" className="text-primary hover:underline">
              Review
            </Link>
            .
          </p>
        </Step>
      </ol>
    </Screen>
  );
}

async function fetchLedgerAccounts(): Promise<LedgerAccount[]> {
  const response = await fetch(
    `${getApiBase()}/tables/accounts?limit=1000&sort=name`,
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as { data: LedgerAccount[] };
  return body.data;
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
      <span className="tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-meta font-semibold text-ink-meta">
        {number}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-row font-semibold text-foreground">{title}</div>
        {children}
      </div>
    </li>
  );
}
