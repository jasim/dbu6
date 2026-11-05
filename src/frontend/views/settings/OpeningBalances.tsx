import { useEffect, useRef, useState } from "react";
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { Lock } from "lucide-react";
import { cn } from "@sapporta/ui/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@sapporta/ui/tooltip";
import { usePageTitle } from "@sapporta/frontend/shell";
import type { OpeningBalanceAccount } from "../../../shared/index";
import { ADD_OTHER_ROUTE } from "../../add-account/state";
import { apiErrorMessage } from "../../api";
import { AgentButton } from "../../components/agent-prompt";
import { EmptyState } from "../../components/empty-state";
import { LoadError } from "../../components/load-error";
import { Screen, ScreenTitle } from "../../components/screen";
import { Button } from "../../components/ui/button";
import { formatDate } from "../../format";
import {
  focuses,
  journalHref,
  lockText,
  openingFigure,
  openingSource,
  recordedGroups,
  sectionOf,
  startedHereEntry,
  unansweredAccounts,
  type BalanceGroup,
} from "../../opening-balances";
import {
  balanceProblem,
  ProblemLine,
  type BalanceProblem,
} from "./OpeningBalanceDialog";
import { BALANCES_SETTINGS_ROUTE, balanceFormHref } from "./routes";
import { useOpeningBalances } from "./opening-balances-data";
import { ownAndOwePrompt } from "./ownAndOwePrompt";

/*
 * Settings' Opening balances: what each account held or owed when the
 * books start, in one table grouped into assets and liabilities, with a
 * Source column for the banks and cards whose first statements set theirs.
 * Clicking a row opens its form, where a balance can be changed or removed
 * until another transaction on its account follows it, or while its journal
 * entry opens other accounts too; after that the row opens its journal.
 * Filling in the accounts with no statements, cash, deposits, investments
 * and loans, is the coding agent's (ownAndOwePrompt); recording one balance
 * by hand is C1's (/add/other), except the balance a link names that an
 * account lacks: a bank or card whose statements print none, which C1
 * doesn't list.
 *
 * One account's form is the URL `/settings/balances/:accountId/edit`, whose
 * route is a child of this one. Recording or removing is not a page of its
 * own: the form's route carries this page's `?account=`, so the row a link
 * named stays highlighted behind it and is still there when it closes.
 */
export function OpeningBalances() {
  usePageTitle("Opening balances");
  const navigate = useNavigate();
  const { search } = useLocation();
  const { query, save, remove, removeUnheld } = useOpeningBalances();
  const [params] = useSearchParams();
  const focus = params.get("account");
  const [removing, setRemoving] = useState<OpeningBalanceAccount | null>(null);
  const [unheld, setUnheld] = useState<OpeningBalanceAccount | null>(null);

  /**
   * Opens an account's balance form in front of this list. It keeps this
   * page's `?account=`, which is what lists the row the form belongs to: the
   * row stays behind the form, and comes back with it.
   */
  const openForm = (account: OpeningBalanceAccount) =>
    void navigate({
      pathname: balanceFormHref(account.account_id),
      search,
    });

  // A link naming an account with no balance goes on to its form, once. The
  // cached list may predate the account (a bank just added), so the link
  // waits for a list that is fresh and names it. A link that already landed
  // on that form — a reload of it — is left where it is.
  const opened = useRef(false);
  const { pathname } = useLocation();
  const data = query.data;
  const fetching = query.isFetching;
  useEffect(() => {
    if (opened.current || !data || fetching || focus === null) return;
    const account = data.accounts.find((one) => focuses(one, focus));
    if (account === undefined) return;
    opened.current = true;
    const section = sectionOf(account, focus);
    if (section && account.opening === null) {
      if (pathname !== balanceFormHref(account.account_id)) openForm(account);
    }
  }, [data, fetching, focus, pathname]);

  const groups = data ? recordedGroups(data, focus) : [];
  const unanswered = data ? unansweredAccounts(data) : [];

  // The form's Remove: back to the list, which asks before removing.
  const askRemove = (account: OpeningBalanceAccount) => {
    setRemoving(account);
    void navigate({ pathname: BALANCES_SETTINGS_ROUTE, search });
  };
  // The agent first, for everything with no statements at once; one
  // balance by hand is the quiet link beside it.
  const addActions = data && (
    <div className="flex flex-wrap items-start gap-x-5 gap-y-2">
      <AgentButton
        label="Fill in what you own and owe"
        prompt={ownAndOwePrompt()}
        afterwards="Answer its questions in the terminal. The balances it records show here."
      />
      <Link
        to={ADD_OTHER_ROUTE}
        className="flex min-h-[calc(var(--height-sap-ctl)+2px)] items-center text-row text-ink-meta underline decoration-sap-border-strong underline-offset-4 hover:text-foreground hover:decoration-current"
      >
        Record a balance by hand
      </Link>
    </div>
  );

  return (
    <Screen
      width="narrow"
      header={
        <ScreenTitle title="Opening balances">
          <p>Opening balances of each account.</p>
        </ScreenTitle>
      }
    >
      <div className="mt-6">
        {query.isPending && (
          <p className="text-body text-ink-meta">Loading your balances…</p>
        )}
        {query.isError && (
          <LoadError
            title="Couldn't load your balances"
            message={apiErrorMessage(query.error)}
            retry={() => void query.refetch()}
          />
        )}
        {data && (
          <>
            {unanswered.length > 0 && (
              <UnansweredTable
                accounts={unanswered}
                onOpen={openForm}
                save={save}
                onRemove={setUnheld}
              />
            )}
            {groups.length === 0 ? (
              <EmptyState
                title="No opening balances yet"
                body="Banks and cards get theirs from their first statement."
                action={addActions}
              />
            ) : (
              <>
                <BalanceTable groups={groups} focus={focus} onOpen={openForm} />
                <div className="mt-5">{addActions}</div>
              </>
            )}
            <RemoveDialog
              account={removing}
              remove={remove}
              onClose={() => setRemoving(null)}
            />
            <UnheldDialog
              account={unheld}
              remove={removeUnheld}
              onClose={() => setUnheld(null)}
            />
            {/* The open form, as `/settings/balances/:accountId/edit`: it
                reads the list above through the Outlet, so opening it reads
                nothing again. */}
            <Outlet context={{ data, save, askRemove }} />
          </>
        )}
      </div>
    </Screen>
  );
}

/**
 * The check: each account nobody has said how it starts, with its three
 * answers. "It started here" records an opening of 0 the day before its
 * first transaction, so it needs one; "I don't have this" deletes the
 * account, while nothing is on it.
 */
function UnansweredTable({
  accounts,
  onOpen,
  save,
  onRemove,
}: {
  accounts: OpeningBalanceAccount[];
  onOpen: (account: OpeningBalanceAccount) => void;
  save: (
    account: OpeningBalanceAccount,
    entry: { date: string; amount: number; description?: string },
  ) => Promise<void>;
  onRemove: (account: OpeningBalanceAccount) => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function startedHere(account: OpeningBalanceAccount) {
    const entry = startedHereEntry(account);
    if (entry === null) return;
    setBusy(account.account_id);
    setProblem(null);
    try {
      await save(account, entry);
    } catch (error) {
      setProblem(apiErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="no-starting-balance" className="mb-8">
      <h2
        id="no-starting-balance"
        className="text-label uppercase text-ink-meta"
      >
        No starting balance
      </h2>
      <p className="mt-1 text-body text-foreground">
        Net worth is incomplete until each of these has one.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-row">
          <thead className="border-b border-sap-border text-left text-meta text-ink-meta">
            <tr>
              <th scope="col" className="py-2.5 pr-3 font-medium">
                Account
              </th>
              <th
                scope="col"
                className="hidden w-36 px-3 py-2.5 font-medium sm:table-cell"
              >
                First transaction
              </th>
              <th scope="col" className="py-2.5 pl-3">
                <span className="sr-only">Answers</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => {
              const canStart = startedHereEntry(account) !== null;
              return (
                <tr
                  key={account.account_id}
                  className="border-b border-line-inner"
                >
                  <td className="py-2.5 pr-3 align-middle font-semibold text-foreground">
                    {account.name}
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2.5 sm:table-cell">
                    {account.first_activity_date ? (
                      <span className="tnum">
                        {formatDate(account.first_activity_date)}
                      </span>
                    ) : (
                      <span className="text-ink-meta">—</span>
                    )}
                  </td>
                  <td className="py-1.5 pl-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`${account.name}: it had a balance`}
                        onClick={() => onOpen(account)}
                      >
                        It had a balance
                      </Button>
                      {canStart && (
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`${account.name}: it started here`}
                          disabled={busy !== null}
                          onClick={() => void startedHere(account)}
                        >
                          {busy === account.account_id
                            ? "Recording…"
                            : "It started here"}
                        </Button>
                      )}
                      {account.removable && (
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`${account.name}: I don't have this`}
                          onClick={() => onRemove(account)}
                        >
                          I don't have this
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {problem && (
        <p role="alert" className="mt-3 text-body text-destructive">
          {problem}
        </p>
      )}
    </section>
  );
}

/** "I don't have this": asks before the account is deleted. */
function UnheldDialog({
  account,
  remove,
  onClose,
}: {
  account: OpeningBalanceAccount | null;
  remove: (account: OpeningBalanceAccount) => Promise<void>;
  onClose: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setProblem(null);
    onClose();
  };

  async function confirm() {
    if (account === null) return;
    setSaving(true);
    setProblem(null);
    try {
      await remove(account);
      close();
    } catch (error) {
      setProblem(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={account !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        {account && (
          <>
            <DialogHeader>
              <DialogTitle>Delete {account.name}?</DialogTitle>
              <DialogDescription>
                Nothing is on it. It leaves your chart of accounts.
              </DialogDescription>
            </DialogHeader>
            {problem && (
              <p role="alert" className="mt-4 text-body text-destructive">
                {problem}
              </p>
            )}
            <DialogFooter className="mt-6">
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={saving}
                onClick={() => void confirm()}
              >
                {saving ? "Deleting…" : "Delete account"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BalanceTable({
  groups,
  focus,
  onOpen,
}: {
  groups: BalanceGroup[];
  focus: string | null;
  /** Opens the account's dialog, to add its balance or edit it. */
  onOpen: (account: OpeningBalanceAccount) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-row">
        <thead className="border-b border-sap-border text-left text-meta text-ink-meta">
          <tr>
            <th scope="col" className="py-2.5 pr-3 font-medium">
              Account
            </th>
            <th
              scope="col"
              className="hidden w-32 px-3 py-2.5 font-medium sm:table-cell"
            >
              As of
            </th>
            {/* Each group's row names its amounts: balance or owed. */}
            <th scope="col" className="w-[7.5rem] px-3 py-2.5 sm:w-40">
              <span className="sr-only">Amount</span>
            </th>
            <th
              scope="col"
              className="hidden w-48 px-3 py-2.5 font-medium sm:table-cell"
            >
              Source
            </th>
            <th scope="col" className="w-[4.75rem] py-2.5 pl-3 sm:w-16">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.section}>
            <tr className="border-b border-sap-border">
              <th
                scope="rowgroup"
                colSpan={2}
                className="pt-6 pb-2 text-left text-label uppercase text-ink-meta"
              >
                {group.term}
              </th>
              <td className="px-3 pt-6 pb-2 text-right text-meta text-ink-meta">
                {group.amountHeading}
              </td>
              <td colSpan={2} />
            </tr>
            {group.accounts.map((account) => (
              <BalanceRow
                key={account.account_id}
                account={account}
                section={group.section}
                focused={focuses(account, focus)}
                onOpen={() => onOpen(account)}
              />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/**
 * One balance. Clicking the row opens its form, or, for a balance only its
 * journal entry can change, that entry.
 */
function BalanceRow({
  account,
  section,
  focused,
  onOpen,
}: {
  account: OpeningBalanceAccount;
  section: BalanceGroup["section"];
  focused: boolean;
  onOpen: () => void;
}) {
  const navigate = useNavigate();
  const row = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (focused) row.current?.scrollIntoView?.({ block: "center" });
  }, [focused]);

  const { opening } = account;
  const journal =
    opening !== null && opening.locked !== null
      ? journalHref(opening.journal_id)
      : null;
  const open = () => (journal ? void navigate(journal) : onOpen());
  const figure = openingFigure(section, account);
  const dash = <span className="text-ink-meta">—</span>;
  const nameClass =
    "text-left font-semibold text-foreground outline-none focus-visible:underline focus-visible:underline-offset-4";
  return (
    <tr
      ref={row}
      aria-current={focused ? "true" : undefined}
      onClick={open}
      className={cn(
        "cursor-pointer border-b border-line-inner hover:bg-muted",
        focused && "bg-attention-bg",
      )}
    >
      <td className="py-2.5 pr-3 align-middle">
        {/* The row's click, for the keyboard. */}
        {journal ? (
          <Link
            to={journal}
            className={nameClass}
            onClick={(event) => event.stopPropagation()}
          >
            {account.name}
          </Link>
        ) : (
          <button
            type="button"
            className={nameClass}
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            {account.name}
          </button>
        )}
        {/* On a phone, the column it drops. */}
        {opening && (
          <div className="text-meta text-ink-meta sm:hidden">
            As of {formatDate(opening.date)}
          </div>
        )}
      </td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 sm:table-cell">
        {opening ? (
          <span className="tnum">{formatDate(opening.date)}</span>
        ) : (
          dash
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {figure === null ? (
          dash
        ) : (
          <span className="tnum font-mono">{figure}</span>
        )}
      </td>
      <td className="hidden px-3 py-2.5 text-ink-meta sm:table-cell">
        {opening && openingSource(opening)}
      </td>
      <td className="whitespace-nowrap py-1.5 pl-3 text-right">
        {opening === null ? (
          <Button
            variant="outline"
            size="sm"
            aria-label={`Add a balance for ${account.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            Add
          </Button>
        ) : (
          opening.locked !== null && (
            <Tooltip>
              <TooltipTrigger
                delay={0}
                aria-label={lockText(opening.locked)}
                render={<span />}
                className="inline-flex h-sap-ctl w-[var(--height-sap-ctl)] items-center justify-center text-ink-meta [&_svg]:size-4"
              >
                <Lock />
              </TooltipTrigger>
              <TooltipContent side="left">
                {lockText(opening.locked)}
              </TooltipContent>
            </Tooltip>
          )
        )}
      </td>
    </tr>
  );
}

function RemoveDialog({
  account,
  remove,
  onClose,
}: {
  account: OpeningBalanceAccount | null;
  remove: (account: OpeningBalanceAccount) => Promise<void>;
  onClose: () => void;
}) {
  const [problem, setProblem] = useState<BalanceProblem | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setProblem(null);
    onClose();
  };

  async function confirm() {
    if (account === null) return;
    setSaving(true);
    setProblem(null);
    try {
      await remove(account);
      close();
    } catch (error) {
      setProblem(balanceProblem(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={account !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        {account && (
          <>
            <DialogHeader>
              <DialogTitle>Remove the balance for {account.name}?</DialogTitle>
              <DialogDescription>
                Its opening entry is deleted from your books.
              </DialogDescription>
            </DialogHeader>
            {problem && <ProblemLine problem={problem} />}
            <DialogFooter className="mt-6">
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={saving || problem?.lockedJournal != null}
                onClick={() => void confirm()}
              >
                {saving ? "Removing…" : "Remove"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
