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
import { ApiError } from "@sapporta/shared/client";
import type { OpeningBalanceAccount, OpeningSection } from "../../shared/index";
import { apiErrorMessage, openingBalancesApi } from "../api";
import { EmptyState } from "../components/empty-state";
import { LoadError } from "../components/load-error";
import { Button } from "../components/ui/button";
import { formatDate } from "../format";
import { openingBalancesQuery, refreshSetup } from "../queries";
import {
  OpeningBalanceDialog,
  type BalanceEditing,
  type BalanceEntry,
} from "./OpeningBalanceDialog";
import { RowMenu } from "./RowMenu";
import { SetupFrame, StepHeading } from "./SetupWizard";
import {
  balanceSections,
  focuses,
  lockText,
  openingFigure,
  parentLine,
  sectionOf,
  type BalanceSection,
} from "./other-balances";
import { SETUP_STEP_ROUTES } from "./steps";

/*
 * Step 4, optional: what the accounts no statement covers held when the
 * books start. Cash, investments and loans get one balance each; the banks
 * and cards, whose first statements set theirs, are listed below them to
 * check. A recorded balance can be changed or removed here until another
 * transaction on its account follows it, or while its journal entry opens
 * other accounts too.
 */
export function BalancesStep() {
  const client = useQueryClient();
  const query = useQuery(openingBalancesQuery);
  const [params] = useSearchParams();
  const focus = params.get("account");
  const [editing, setEditing] = useState<BalanceEditing | null>(null);
  const [removing, setRemoving] = useState<OpeningBalanceAccount | null>(null);

  // A refusal says the list was out of date: read it again.
  const afterRefusal = (error: unknown): never => {
    if (error instanceof ApiError && error.status === 409) {
      void query.refetch();
    }
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
    ).catch(afterRefusal);
    await refreshSetup(client);
  };
  const remove = async (account: OpeningBalanceAccount) => {
    await openingBalancesApi
      .remove({ params: { accountId: account.account_id }, body: {} })
      .catch(afterRefusal);
    await refreshSetup(client);
  };

  // A link naming an account with no balance opens its dialog, once.
  const opened = useRef(false);
  const data = query.data;
  useEffect(() => {
    if (opened.current || !data || focus === null) return;
    opened.current = true;
    const account = data.accounts.find((one) => focuses(one, focus));
    const section = account && sectionOf(account, focus);
    if (account && section && account.opening === null) {
      setEditing({ account, section });
    }
  }, [data, focus]);

  const sections = data ? balanceSections(data, focus) : [];

  return (
    <SetupFrame step="balances">
      <StepHeading title="Add your other balances">
        What cash, investments and loans held when your books start. Optional.
      </StepHeading>
      {query.isPending && (
        <p className="text-body text-ink-meta">Loading your accounts…</p>
      )}
      {query.isError && (
        <LoadError
          title="Couldn't load your accounts"
          message={apiErrorMessage(query.error)}
          retry={() => void query.refetch()}
        />
      )}
      {data && (
        <>
          <div className="space-y-6">
            {data.accounts.length === 0 ? (
              <EmptyState
                title="Create your chart of accounts first"
                body="Cash, investments and loans are accounts in it."
                action={
                  <Button
                    render={<Link to={SETUP_STEP_ROUTES.accounts} />}
                    nativeButton={false}
                    variant="outline"
                    size="sm"
                  >
                    Choose a chart
                  </Button>
                }
              />
            ) : (
              !sections.some((one) => one.section !== "statement") && (
                <EmptyState
                  title="No cash, investment or loan accounts"
                  body="Add them on the Accounts page, then come back."
                  action={
                    <Button
                      render={<Link to="/accounts" />}
                      nativeButton={false}
                      variant="outline"
                      size="sm"
                    >
                      Accounts page
                    </Button>
                  }
                />
              )
            )}
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
          <div className="mt-8 flex justify-end">
            <Button
              render={<Link to={SETUP_STEP_ROUTES.review} />}
              nativeButton={false}
            >
              Next: Review
            </Button>
          </div>
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
    </SetupFrame>
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
        <table className="w-full text-row">
          <thead className="text-left text-meta text-ink-meta">
            <tr>
              <th scope="col" className="py-2.5 pl-5 pr-3 font-medium">
                Account
              </th>
              <th
                scope="col"
                className="hidden px-3 py-2.5 font-medium sm:table-cell"
              >
                As of
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">
                {section.amountHeading}
              </th>
              <th scope="col" className="py-2.5 pl-3 pr-4">
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
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
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
                className="inline-flex h-sap-ctl w-[var(--height-sap-ctl)] items-center justify-center rounded-control text-ink-meta outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 [&_svg]:size-4"
              >
                <Lock />
              </TooltipTrigger>
              <TooltipContent side="left">
                {lockText(opening.locked)}
              </TooltipContent>
            </Tooltip>
            <Link
              to={`/tables/journals?filter[id][eq]=${opening.journal_id}`}
              aria-label={`Open the journal entry for ${account.name}`}
              className="text-meta text-primary underline-offset-4 hover:underline"
            >
              Journal entry
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
              <DialogTitle>Remove the balance for {account.name}?</DialogTitle>
              <DialogDescription>
                Its opening entry is deleted from your books.
              </DialogDescription>
            </DialogHeader>
            {problem && (
              <p role="alert" className="mt-3 text-body text-destructive">
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
                {saving ? "Removing…" : "Remove"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
