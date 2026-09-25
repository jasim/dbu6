import { useId, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@sapporta/frontend/shell";
import { cn } from "@sapporta/ui/cn";
import type { AccountInstructions } from "../../../shared/index";
import { apiErrorMessage } from "../../api";
import { CopyButton } from "../../components/agent-prompt";
import { EmptyState } from "../../components/empty-state";
import { LoadError } from "../../components/load-error";
import { Screen, ScreenTitle } from "../../components/screen";
import { StatusChip } from "../../components/status-chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "../../components/ui/select";
import { plural } from "../../format";
import {
  accountInstructionsQuery,
  importPresetsQuery,
  transactionMappingsQuery,
} from "../../queries";
import {
  presetAccounts,
  presetNames,
  type PresetAccount,
} from "../categorization/CategorizationInstructions";
import { fileUsers, otherUsers } from "./file-users";
import { TransactionMappingsPanel } from "./TransactionMappingsPanel";

// The search that shows transaction_mappings.mjs rather than an account.
const MAPPINGS_SEARCH = `?${new URLSearchParams({ show: "mappings" })}`;
// The phone picker's value for the rules.
const RULES = "rules";
const PAGE_TITLE = "Automatic transaction categorization rules";

function accountSearch(accountId: number): string {
  return `?${new URLSearchParams({ account: String(accountId) })}`;
}

/*
 * Automatic transaction categorization rules: what the categoriser uses when
 * a statement is imported. The common rules, in transaction_mappings.mjs, go
 * first for every account; then, for each
 * account an import preset lists, its guidance, the instruction files it
 * names, in order, each as the text the coding agent gets. A file shared by
 * several accounts says which. Read-only: the files are edited in
 * user-config/, and which files an account lists is changed through the
 * presets' API.
 */
export function ImportInstructions() {
  usePageTitle(PAGE_TITLE);
  const presets = useQuery(importPresetsQuery);
  const [params] = useSearchParams();

  const accounts = useMemo(
    () => (presets.data ? presetAccounts(presets.data) : []),
    [presets.data],
  );
  const names = useMemo(() => presetNames(accounts), [accounts]);
  const users = useMemo(() => fileUsers(accounts), [accounts]);
  const showMappings = params.get("show") === "mappings";
  const wanted = Number(params.get("account"));
  const chosen =
    accounts.find((one) => one.account.account_id === wanted) ??
    accounts[0] ??
    null;
  const chosenId = showMappings ? null : (chosen?.account.account_id ?? null);

  return (
    <Screen
      width="wide"
      header={
        <ScreenTitle title={PAGE_TITLE}>
          <p>
            When you import a bank or card statement, these decide which account
            each transaction goes to: the common rules first, then the account's
            own guidance.
          </p>
        </ScreenTitle>
      }
    >
      <div className="mt-6">
        {presets.isPending && (
          <p className="text-body text-ink-meta">Loading…</p>
        )}
        {presets.isError && (
          <LoadError
            title="Couldn't load the accounts"
            message={apiErrorMessage(presets.error)}
            retry={() => void presets.refetch()}
          />
        )}
        {presets.data && (
          <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
            <PagePicker accounts={accounts} names={names} chosenId={chosenId} />
            <AccountList
              accounts={accounts}
              names={names}
              chosenId={chosenId}
              mappingsChosen={showMappings}
            />
            {showMappings ? (
              <TransactionMappingsPanel />
            ) : chosen !== null ? (
              <AccountPanel
                // Another account's panel starts from the top.
                key={chosen.account.account_id}
                chosen={chosen}
                names={names}
                users={users}
              />
            ) : (
              <EmptyState
                title="No accounts yet"
                body="Guidance belongs to your banks and cards. Add one and its guidance shows here."
              />
            )}
          </div>
        )}
      </div>
    </Screen>
  );
}

/**
 * On a phone, the list is one select above the panel, so the panel isn't a
 * screen of links away.
 */
function PagePicker({
  accounts,
  names,
  chosenId,
}: {
  accounts: readonly PresetAccount[];
  names: ReadonlyMap<number, string>;
  chosenId: number | null;
}) {
  const navigate = useNavigate();
  const items: Record<string, string> = {
    [RULES]: "Common rules",
    ...Object.fromEntries(
      accounts.map(({ account }) => [
        String(account.account_id),
        names.get(account.account_id) ?? account.name,
      ]),
    ),
  };
  return (
    <div className="md:hidden">
      <Select<string>
        items={items}
        value={chosenId === null ? RULES : String(chosenId)}
        onValueChange={(value) =>
          navigate(
            value === null || value === RULES
              ? MAPPINGS_SEARCH
              : accountSearch(Number(value)),
            { replace: true },
          )
        }
      >
        <SelectLabel className="sr-only">Show</SelectLabel>
        <SelectTrigger placeholder="Common rules" />
        <SelectContent>
          <SelectItem value={RULES}>Common rules</SelectItem>
          {accounts.map(({ account }) => (
            <SelectItem
              key={account.account_id}
              value={String(account.account_id)}
            >
              {names.get(account.account_id)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function AccountList({
  accounts,
  names,
  chosenId,
  mappingsChosen,
}: {
  accounts: readonly PresetAccount[];
  names: ReadonlyMap<number, string>;
  chosenId: number | null;
  mappingsChosen: boolean;
}) {
  const mappings = useQuery(transactionMappingsQuery);
  return (
    <nav aria-label="Categorization rules" className="space-y-4 max-md:hidden">
      <ListLink
        to={MAPPINGS_SEARCH}
        current={mappingsChosen}
        label="Common rules"
        meta={
          mappings.data?.state === "unreadable"
            ? "Can't be read"
            : "Applies to every account"
        }
      />
      {accounts.length > 0 && (
        <div className="space-y-1">
          <div className="px-2 text-label font-semibold uppercase tracking-wide text-ink-meta">
            Guidance
          </div>
          <ul className="space-y-0.5">
            {accounts.map(({ account }) => {
              const count = account.custom_mappings_filenames.length;
              return (
                <li key={account.account_id}>
                  <ListLink
                    to={accountSearch(account.account_id)}
                    current={account.account_id === chosenId}
                    label={names.get(account.account_id) ?? account.name}
                    meta={count === 0 ? "None" : plural(count, "file")}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </nav>
  );
}

function ListLink({
  to,
  current,
  label,
  meta,
}: {
  to: string;
  current: boolean;
  label: string;
  meta: string;
}) {
  return (
    <Link
      to={to}
      replace
      aria-current={current ? "page" : undefined}
      className={cn(
        "block rounded-control px-2 py-1.5 no-underline transition-colors",
        current
          ? "bg-sap-nested text-foreground"
          : "text-ink-soft hover:bg-sap-row-hover hover:text-foreground",
      )}
    >
      <span className="block truncate text-row font-semibold">{label}</span>
      <span className="block text-meta text-ink-meta">{meta}</span>
    </Link>
  );
}

/**
 * One account's guidance: its files in the order a run joins them, each
 * with its text, and the accounts that share it.
 */
function AccountPanel({
  chosen,
  names,
  users,
}: {
  chosen: PresetAccount;
  names: ReadonlyMap<number, string>;
  users: ReadonlyMap<string, readonly PresetAccount[]>;
}) {
  const { account, institution } = chosen;
  const headingId = useId();
  const instructions = useQuery(accountInstructionsQuery(account.account_id));
  const kind = account.is_credit_card ? "Credit card" : "Bank account";

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={headingId} className="text-heading text-foreground">
            {names.get(account.account_id) ?? account.name}
          </h2>
          <p className="mt-0.5 text-meta text-ink-meta">
            {institution === account.name ? kind : `${institution} · ${kind}`}
          </p>
        </div>
        {instructions.data && instructions.data.text !== "" && (
          <CopyButton text={instructions.data.text} label="Copy all" />
        )}
      </div>

      {account.ledger_account_name === null && (
        <p className="text-meta text-attention-ink">
          Not in your books any more, so nothing imports into it.
        </p>
      )}

      {account.custom_mappings_filenames.length === 0 ? (
        <p className="rounded-control border border-dashed px-3 py-2 text-body text-ink-meta">
          No guidance. The categorizer goes by your account names.
        </p>
      ) : (
        <>
          {instructions.isPending && (
            <p className="text-meta text-ink-meta">Reading the files…</p>
          )}
          {instructions.isError && (
            <LoadError
              title="Couldn't read the files"
              message={apiErrorMessage(instructions.error)}
              retry={() => void instructions.refetch()}
            />
          )}
          {instructions.data && (
            <Files
              instructions={instructions.data}
              others={(filename) =>
                otherUsers(users, filename, account.account_id)
              }
            />
          )}
        </>
      )}

      <p className="text-meta text-ink-meta">
        Edit these in user-config/, or ask your coding agent to.
      </p>
    </section>
  );
}

/**
 * The account's files, one card each in the order a run joins them: the
 * file's name, who else uses it, and its text. A missing file says so where
 * its text would be.
 */
function Files({
  instructions,
  others,
}: {
  instructions: AccountInstructions;
  others: (filename: string) => string[];
}) {
  return (
    <ol className="space-y-3">
      {instructions.files.map((file) => {
        const shared = others(file.filename);
        return (
          <li
            key={file.filename}
            className="overflow-hidden rounded-control border bg-card"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b bg-muted px-3 py-1.5">
              <span className="font-mono text-label text-ink-soft [overflow-wrap:anywhere]">
                {file.filename}
              </span>
              {file.content === null && (
                <StatusChip tone="attention">Missing</StatusChip>
              )}
              {shared.length > 0 && (
                <span className="ml-auto text-label text-ink-meta">
                  Also used by {shared.join(", ")}
                </span>
              )}
            </div>
            {file.content === null ? (
              <p className="px-3 py-2 text-meta text-attention-ink">
                Not in user-config/, so the categorizer skips it.
              </p>
            ) : (
              <pre className="whitespace-pre-wrap px-3 py-3 font-mono text-meta leading-relaxed text-foreground [overflow-wrap:anywhere]">
                {file.content}
              </pre>
            )}
          </li>
        );
      })}
    </ol>
  );
}
