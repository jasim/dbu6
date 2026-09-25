import { useId, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@sapporta/frontend/shell";
import { cn } from "@sapporta/ui/cn";
import type {
  AccountInstructions,
  ImportPresetsView,
} from "../../../shared/index";
import { apiErrorMessage } from "../../api";
import { CopyButton } from "../../components/agent-prompt";
import { EmptyState } from "../../components/empty-state";
import { LoadError } from "../../components/load-error";
import { Screen, ScreenTitle } from "../../components/screen";
import { StatusChip } from "../../components/status-chip";
import {
  accountInstructionsQuery,
  importPresetsQuery,
  transactionMappingsQuery,
} from "../../queries";
import {
  presetAccounts,
  type PresetAccount,
} from "../categorization/CategorizationInstructions";
import { fileUsers, otherUsers } from "./file-users";
import { ruleCount } from "./mapping-rules";
import { TransactionMappingsPanel } from "./TransactionMappingsPanel";

export const IMPORT_INSTRUCTIONS_ROUTE = "/import-instructions";

// The search that shows transaction_mappings.mjs rather than an account.
const MAPPINGS_SEARCH = `?${new URLSearchParams({ show: "mappings" })}`;

/*
 * Categorization instructions: for each account an import preset lists, the
 * instruction files it names, in order, and the text the coding agent gets
 * from them. An account has its own list and nothing is inherited, so what
 * is shown for an account is everything it uses. A file shared by several
 * accounts says which. Above the accounts, the transaction mappings every
 * account's entries go through first. Read-only: the files are edited in
 * user-config/, and which files an account lists is changed through the
 * presets' API.
 */
export function ImportInstructions() {
  usePageTitle("Categorization instructions");
  const presets = useQuery(importPresetsQuery);
  const [params] = useSearchParams();

  const accounts = useMemo(
    () => (presets.data ? presetAccounts(presets.data) : []),
    [presets.data],
  );
  const users = useMemo(() => fileUsers(accounts), [accounts]);
  const showMappings = params.get("show") === "mappings";
  const wanted = Number(params.get("account"));
  const chosen =
    accounts.find((one) => one.account.account_id === wanted) ??
    accounts[0] ??
    null;

  return (
    <Screen
      width="wide"
      header={
        <ScreenTitle title="Categorization instructions">
          <p>
            What the coding agent reads when it categorizes an account's
            imported entries. Each account lists its own instruction files in
            user-config/, and they are joined in that order. A file can be
            listed by more than one account.
          </p>
          <p>
            Your mapping rules in{" "}
            <Link
              to={MAPPINGS_SEARCH}
              replace
              className="font-mono text-meta text-foreground underline-offset-4 hover:underline"
            >
              transaction_mappings.mjs
            </Link>{" "}
            apply to every account and go first; the coding agent only sees the
            entries they don't match.
          </p>
        </ScreenTitle>
      }
    >
      <div className="mt-6">
        {presets.isPending && (
          <p className="text-body text-ink-meta">Loading the presets…</p>
        )}
        {presets.isError && (
          <LoadError
            title="Couldn't load the import presets"
            message={apiErrorMessage(presets.error)}
            retry={() => void presets.refetch()}
          />
        )}
        {presets.data && (
          <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
            <AccountList
              institutions={presets.data.institutions}
              chosenId={
                showMappings ? null : (chosen?.account.account_id ?? null)
              }
              mappingsChosen={showMappings}
            />
            {showMappings ? (
              <TransactionMappingsPanel />
            ) : chosen !== null ? (
              <AccountPanel
                // Another account's panel starts from the top.
                key={chosen.account.account_id}
                chosen={chosen}
                users={users}
              />
            ) : (
              <EmptyState
                title="No accounts to show"
                body="Instructions belong to the accounts in your import presets. Once an institution lists an account, its instruction files show here."
              />
            )}
          </div>
        )}
      </div>
    </Screen>
  );
}

function AccountList({
  institutions,
  chosenId,
  mappingsChosen,
}: {
  institutions: ImportPresetsView["institutions"];
  chosenId: number | null;
  mappingsChosen: boolean;
}) {
  const mappings = useQuery(transactionMappingsQuery);
  return (
    <nav aria-label="Accounts" className="space-y-4">
      <div className="space-y-1">
        <div className="px-2 text-label font-semibold uppercase tracking-wide text-ink-meta">
          Every account
        </div>
        <ListLink
          to={MAPPINGS_SEARCH}
          current={mappingsChosen}
          label="Transaction mappings"
          meta={
            mappings.data?.state === "read"
              ? `${ruleCount(mappings.data)} rules, applied first`
              : mappings.data?.state === "unreadable"
                ? "Can't be read"
                : "Applied first"
          }
        />
      </div>
      {institutions
        .filter((institution) => institution.accounts.length > 0)
        .map((institution) => (
          <div key={institution.id} className="space-y-1">
            <div className="px-2 text-label font-semibold uppercase tracking-wide text-ink-meta">
              {institution.name}
            </div>
            <ul className="space-y-0.5">
              {institution.accounts.map((account) => {
                const count = account.custom_mappings_filenames.length;
                return (
                  <li key={account.account_id}>
                    <ListLink
                      to={`?${new URLSearchParams({ account: String(account.account_id) })}`}
                      current={account.account_id === chosenId}
                      label={account.name}
                      meta={
                        count === 0
                          ? "No files"
                          : count === 1
                            ? "1 file"
                            : `${count} files`
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
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

function AccountPanel({
  chosen,
  users,
}: {
  chosen: PresetAccount;
  users: ReadonlyMap<string, readonly PresetAccount[]>;
}) {
  const { account, institution } = chosen;
  const headingId = useId();
  const instructions = useQuery(accountInstructionsQuery(account.account_id));
  const filenames = account.custom_mappings_filenames;
  const missing = new Set(
    instructions.data?.files
      .filter((file) => file.content === null)
      .map((file) => file.filename),
  );

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-6">
      <div>
        <h2 id={headingId} className="text-heading text-foreground">
          {account.name}
        </h2>
        <p className="mt-0.5 text-meta text-ink-meta">
          {institution} · {account.is_credit_card ? "Credit card" : "Account"}
        </p>
        {account.ledger_account_name === null && (
          <p className="mt-2 text-meta text-attention-ink">
            This account is no longer in your ledger, so nothing imports into
            it.
          </p>
        )}
      </div>

      {filenames.length === 0 ? (
        <p className="rounded-control border border-dashed px-3 py-2 text-body text-ink-meta">
          {account.name} names no instruction files, so the coding agent
          categorizes its entries from your account names alone.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            <h3 className="text-row font-semibold text-foreground">
              Files, in the order they are joined
            </h3>
            <ol className="divide-y rounded-control border bg-card">
              {filenames.map((filename, index) => {
                const others = otherUsers(users, filename, account.account_id);
                return (
                  <li
                    key={filename}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2"
                  >
                    <span className="tnum w-4 text-meta text-ink-meta">
                      {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        document
                          .getElementById(fileAnchor(filename))
                          ?.scrollIntoView({ behavior: "smooth" })
                      }
                      className="font-mono text-meta text-foreground underline-offset-4 hover:underline"
                    >
                      {filename}
                    </button>
                    {missing.has(filename) && (
                      <StatusChip tone="attention">
                        Missing, left out
                      </StatusChip>
                    )}
                    <span className="basis-full pl-7 text-meta text-ink-meta sm:basis-auto sm:pl-0">
                      {others.length === 0
                        ? "Only this account"
                        : `Also used by ${others.join(", ")}`}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-row font-semibold text-foreground">
                What the coding agent reads
              </h3>
              {instructions.data && instructions.data.text !== "" && (
                <CopyButton text={instructions.data.text} label="Copy text" />
              )}
            </div>
            {instructions.isPending && (
              <p className="text-meta text-ink-meta">Reading the files…</p>
            )}
            {instructions.isError && (
              <LoadError
                title="Couldn't read the instruction files"
                message={apiErrorMessage(instructions.error)}
                retry={() => void instructions.refetch()}
              />
            )}
            {instructions.data && <FullText instructions={instructions.data} />}
          </div>
        </>
      )}

      <p className="text-meta text-ink-meta">
        To change what a file says, edit it in user-config/; every account that
        lists it changes with it. To change which files {account.name} uses, or
        their order, ask your coding agent to update its import preset.
      </p>
    </section>
  );
}

/**
 * The account's files as one text, the way a run joins them, each file
 * marked where it starts. A missing file is marked where it would go.
 */
function FullText({ instructions }: { instructions: AccountInstructions }) {
  return (
    <div className="overflow-hidden rounded-control border bg-card">
      {instructions.files.map((file) => (
        <div
          key={file.filename}
          id={fileAnchor(file.filename)}
          className="scroll-mt-4 border-b last:border-b-0"
        >
          <div className="border-b bg-muted px-3 py-1 font-mono text-label text-ink-meta">
            {file.filename}
          </div>
          {file.content === null ? (
            <p className="px-3 py-2 text-meta text-attention-ink">
              There is no user-config/{file.filename}, so this part is left out.
            </p>
          ) : (
            <pre className="whitespace-pre-wrap px-3 py-3 font-mono text-meta leading-relaxed text-foreground [overflow-wrap:anywhere]">
              {file.content}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function fileAnchor(filename: string): string {
  return `file-${filename}`;
}
