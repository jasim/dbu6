import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import type {
  OpeningBalanceAccount,
  OpeningSection,
} from "../../../shared/index";
import { ADD_OTHER_ROUTE } from "../../add-account/state";
import { apiErrorMessage, openingBalancesApi } from "../../api";
import { EmptyState } from "../../components/empty-state";
import { LoadError } from "../../components/load-error";
import { Screen, ScreenTitle } from "../../components/screen";
import { Button } from "../../components/ui/button";
import { formatDate } from "../../format";
import { openingBalancesQuery, refreshSetup } from "../../queries";
import {
  focuses,
  journalHref,
  lockText,
  openingFigure,
  parentLine,
  recordedSections,
  sectionOf,
  type BalanceSection,
} from "../../opening-balances";
import {
  balanceProblem,
  OpeningBalanceDialog,
  ProblemLine,
  type BalanceEditing,
  type BalanceEntry,
  type BalanceProblem,
} from "./OpeningBalanceDialog";
import { RowMenu } from "./RowMenu";

/*
 * Settings' Opening balances: what each account held or owed when the
 * books start. Cash, investments and loans come first; the banks and cards,
 * whose first statements set theirs, below them. A balance can be changed
 * or removed here until another transaction on its account follows it, or
 * while its journal entry opens other accounts too. Recording one is C1's
 * (/add/other), except the balance a link names that an account lacks: a
 * bank or card whose statements print none, which C1 doesn't list.
 */
export function OpeningBalances() {
  usePageTitle("Opening balances");
  const client = useQueryClient();
  const query = useQuery(openingBalancesQuery);
  const [params] = useSearchParams();
  const focus = params.get("account");
  const [editing, setEditing] = useState<BalanceEditing | null>(null);
  const [removing, setRemoving] = useState<OpeningBalanceAccount | null>(null);

  // A failure may mean the list is out of date: read it again.
  const afterFailure = (error: unknown): never => {
    void query.refetch();
    throw error;
  };
  const save = async (account: OpeningBalanceAccount, entry: BalanceEntry) => {
    await (
      account.opening === null
        ? openingBalancesApi.record({
            body: { account_id: account.account_id, ...entry },
          })
        : openingBalancesApi.change({
            params: { accountId: account.account_id },
            body: entry,
          })
    ).catch(afterFailure);
    await refreshSetup(client);
  };
  const remove = async (account: OpeningBalanceAccount) => {
    await openingBalancesApi
      .remove({ params: { accountId: account.account_id }, body: {} })
      .catch(afterFailure);
    await refreshSetup(client);
  };

  // A link naming an account with no balance opens its dialog, once. The
  // cached list may predate the account (a bank just added), so the link
  // waits for a list that is fresh and names it.
  const opened = useRef(false);
  const data = query.data;
  const fetching = query.isFetching;
  useEffect(() => {
    if (opened.current || !data || fetching || focus === null) return;
    const account = data.accounts.find((one) => focuses(one, focus));
    if (account === undefined) return;
    opened.current = true;
    const section = sectionOf(account, focus);
    if (section && account.opening === null) {
      setEditing({ account, section });
    }
  }, [data, fetching, focus]);

  const sections = data ? recordedSections(data, focus) : [];
  const addLink = (
    <Link
      to={ADD_OTHER_ROUTE}
      className="text-primary underline-offset-4 hover:underline"
    >
      Add a balance
    </Link>
  );

  return (
    <Screen
      width="narrow"
      header={
        <ScreenTitle title="Opening balances">
          <p>What each account held or owed when your books start.</p>
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
            {sections.length === 0 ? (
              <EmptyState
                title="No opening balances yet"
                body="Banks and cards get theirs from their first statement."
                action={
                  <Button
                    render={<Link to={ADD_OTHER_ROUTE} />}
                    nativeButton={false}
                    variant="outline"
                    size="sm"
                  >
                    Add a balance
                  </Button>
                }
              />
            ) : (
              <>
                <div className="space-y-6">
                  {sections.map((section) => (
                    <SectionTable
                      key={section.section}
                      section={section}
                      focus={focus}
                      onOpen={(account) =>
                        setEditing({ account, section: section.section })
                      }
                      onRemove={setRemoving}
                    />
                  ))}
                </div>
                <p className="mt-4 text-body text-ink-soft">
                  {addLink} for cash, a deposit, an investment or a loan.
                </p>
              </>
            )}
            <OpeningBalanceDialog
              editing={editing}
              save={save}
              onClose={() => setEditing(null)}
            />
            <RemoveDialog
              account={removing}
              remove={remove}
              onClose={() => setRemoving(null)}
            />
          </>
        )}
      </div>
    </Screen>
  );
}

function SectionTable({
  section,
  focus,
  onOpen,
  onRemove,
}: {
  section: BalanceSection;
  focus: string | null;
  /** Opens the account's dialog, to add its balance or edit it. */
  onOpen: (account: OpeningBalanceAccount) => void;
  onRemove: (account: OpeningBalanceAccount) => void;
}) {
  return (
    <section>
      <h3 className="mb-2 text-label uppercase text-ink-meta">
        {section.term}
        <span className="normal-case">
          {" · "}
          {section.caption}
        </span>
      </h3>
      <div className="overflow-x-auto rounded-card border border-sap-border bg-card shadow-card">
        {/* Fixed widths line the three tables' columns up. */}
        <table className="w-full table-fixed text-row">
          <thead className="text-left text-meta text-ink-meta">
            <tr>
              <th scope="col" className="py-2.5 pl-5 pr-3 font-medium">
                Account
              </th>
              <th
                scope="col"
                className="hidden w-36 px-3 py-2.5 font-medium sm:table-cell"
              >
                As of
              </th>
              <th
                scope="col"
                className="w-[7.5rem] px-3 py-2.5 text-right font-medium sm:w-48"
              >
                {section.amountHeading}
              </th>
              <th scope="col" className="w-[4.75rem] py-2.5 pl-3 pr-4 sm:w-40">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {section.accounts.map((account) => (
              <BalanceRow
                key={account.account_id}
                account={account}
                section={section.section}
                focused={focuses(account, focus)}
                onOpen={() => onOpen(account)}
                onRemove={() => onRemove(account)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BalanceRow({
  account,
  section,
  focused,
  onOpen,
  onRemove,
}: {
  account: OpeningBalanceAccount;
  section: OpeningSection;
  focused: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const row = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (focused) row.current?.scrollIntoView?.({ block: "center" });
  }, [focused]);

  const { opening } = account;
  const parents = section === "statement" ? null : parentLine(account);
  const figure = openingFigure(section, account);
  const dash = <span className="text-ink-meta">—</span>;
  return (
    <tr
      ref={row}
      aria-current={focused ? "true" : undefined}
      className={cn("border-t border-line-inner", focused && "bg-attention-bg")}
    >
      <td className="py-2.5 pl-5 pr-3 align-middle">
        <div className="font-semibold text-foreground">{account.name}</div>
        {parents && <div className="text-meta text-ink-meta">{parents}</div>}
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
      <td className="whitespace-nowrap py-1.5 pl-3 pr-4 text-right">
        {opening === null ? (
          <Button
            variant="outline"
            size="sm"
            aria-label={`Add a balance for ${account.name}`}
            onClick={onOpen}
          >
            Add
          </Button>
        ) : opening.locked === null ? (
          <RowMenu name={account.name} onEdit={onOpen} onRemove={onRemove} />
        ) : (
          <span className="inline-flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                delay={0}
                aria-label={lockText(opening.locked)}
                className="hidden h-sap-ctl w-[var(--height-sap-ctl)] items-center justify-center rounded-control text-ink-meta outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:inline-flex [&_svg]:size-4"
              >
                <Lock />
              </TooltipTrigger>
              <TooltipContent side="left">
                {lockText(opening.locked)}
              </TooltipContent>
            </Tooltip>
            {/* On a phone, where there is no hover, the lock is the link. */}
            <Link
              to={journalHref(opening.journal_id)}
              aria-label={`Open the journal entry for ${account.name}`}
              className="inline-flex h-sap-ctl w-[var(--height-sap-ctl)] items-center justify-center rounded-control text-ink-meta outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:w-auto sm:text-meta sm:text-primary sm:underline-offset-4 sm:hover:underline [&_svg]:size-4"
            >
              <Lock aria-hidden="true" className="sm:hidden" />
              <span className="hidden sm:inline">Journal entry</span>
            </Link>
          </span>
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
