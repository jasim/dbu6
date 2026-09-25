import { useId, useState, type ReactNode } from "react";
import { Input } from "@sapporta/ui";
import { cn } from "@sapporta/ui/cn";
import type {
  AccountKind,
  AddAccountCandidate,
  AddAccountFields,
  LlmStatus,
  StatementAccounts,
} from "../../shared/index";
import { Disclosure } from "../components/disclosure";
import { Button } from "../components/ui/button";
import { formatBalance, formatDate } from "../format";
import { AccountCombobox, InstitutionCombobox } from "../setup/pickers";
import {
  unlistedOf,
  withInstitution,
  withName,
  type StatementAccountDraft,
} from "../setup/statement-account-form";
import { confirmDraft, confirmLayout, readConfirm } from "./confirm-form";
import { FocusCard, type FocusFrame } from "./FocusCard";
import type { Opening } from "./state";
import { bankLine, categorizerLine, periodLine } from "./words";

/**
 * Card 4: what dbu6 read, as facts, and the account it goes into. The
 * account is written here and nowhere earlier, with its files imported and
 * categorized; a refusal is one line under the button.
 */
export function Confirm({
  frame,
  account,
  kind,
  opening,
  categorizer,
  data,
  refusal,
  onAdd,
}: {
  frame: FocusFrame;
  account: AddAccountCandidate;
  kind: AccountKind;
  opening: Opening;
  categorizer: LlmStatus;
  data: StatementAccounts;
  /** The server's refusal of the last add, in its words. */
  refusal: string | null;
  onAdd: (fields: AddAccountFields) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => confirmDraft(account, kind, data));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fixed = account.account;

  async function add() {
    const read = readConfirm(account, kind, opening, draft, data);
    if (!read.ok) {
      setProblem(read.problem);
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      await onAdd(read.fields);
    } finally {
      setBusy(false);
    }
  }

  const update = (next: StatementAccountDraft) => {
    setDraft(next);
    setProblem(null);
  };
  const said = busy ? null : (problem ?? refusal);

  return (
    <FocusCard
      {...frame}
      title={fixed ? fixed.name : bankLine(account, kind)}
      lead={fixed ? bankLine(account, kind) : undefined}
      actions={
        <div className="flex flex-col items-end gap-2">
          <Button disabled={busy} onClick={() => void add()}>
            {busy ? "Adding…" : "Add to books"}
          </Button>
          {busy && (
            <p role="status" className="text-meta text-ink-meta">
              Importing and categorizing. This can take a minute.
            </p>
          )}
          {said && (
            <p
              role="alert"
              className="max-w-[440px] text-right text-meta text-destructive [overflow-wrap:anywhere]"
            >
              {said}
            </p>
          )}
        </div>
      }
    >
      <Facts
        account={account}
        kind={kind}
        opening={opening}
        categorizer={categorizer}
      />
      {!fixed && (
        <AccountFields
          account={account}
          kind={kind}
          draft={draft}
          data={data}
          update={update}
        />
      )}
    </FocusCard>
  );
}

/** What the statements say, and who categorizes them. */
function Facts({
  account,
  kind,
  opening,
  categorizer,
}: {
  account: AddAccountCandidate;
  kind: AccountKind;
  opening: Opening;
  categorizer: LlmStatus;
}) {
  return (
    <div className="space-y-1 rounded-control bg-sap-nested px-3.5 py-3 text-row text-foreground">
      <p className="tnum">{periodLine(account)}</p>
      {opening.from === "typed" ? (
        <p className="text-ink-soft">
          Starts at{" "}
          <span className="tnum font-mono">
            {formatBalance(opening.amount, kind)}
          </span>{" "}
          on {formatDate(opening.date)}, as you gave it
        </p>
      ) : opening.from === "books" ? (
        <p className="text-ink-soft">Starts from its opening balance</p>
      ) : (
        <p className="text-primary">
          <span aria-hidden="true">✓</span> Balances add up
        </p>
      )}
      <p
        className={cn(
          "[overflow-wrap:anywhere]",
          categorizer.ready ? "text-ink-soft" : "text-attention-ink",
        )}
      >
        {categorizerLine(categorizer)}
      </p>
    </div>
  );
}

/**
 * The new account's bank (when dbu6 hasn't met it) and name; under More
 * options, its group and an account from the chart to use instead.
 */
function AccountFields({
  account,
  kind,
  draft,
  data,
  update,
}: {
  account: AddAccountCandidate;
  kind: AccountKind;
  draft: StatementAccountDraft;
  data: StatementAccounts;
  update: (draft: StatementAccountDraft) => void;
}) {
  const ids = {
    name: useId(),
    bank: useId(),
    group: useId(),
    existing: useId(),
  };
  const layout = confirmLayout(account, draft, data);
  const existing = draft.source === "existing";
  const [moreOpen, setMoreOpen] = useState(false);

  const group = (
    <Field id={ids.group} label="Group">
      <AccountCombobox
        id={ids.group}
        choices={data.parents[kind]}
        value={draft.parentId}
        onChange={(parentId) => update({ ...draft, parentId })}
        placeholder="Pick a group"
      />
    </Field>
  );
  const groupInView = layout.groupInView && !existing;
  const moreOptions = [
    !groupInView && !existing && group,
    layout.canUseExisting && (
      <Field id={ids.existing} label="An account from your chart">
        <AccountCombobox
          id={ids.existing}
          choices={unlistedOf(data, kind)}
          value={draft.existingId}
          onChange={(existingId) =>
            update({
              ...draft,
              existingId,
              source: existingId === null ? "new" : "existing",
            })
          }
          placeholder="None: add a new one"
        />
      </Field>
    ),
  ].filter(Boolean);

  return (
    <div className="mt-5 space-y-4">
      {layout.bank && (
        <Field id={ids.bank} label={kind === "card" ? "Card issuer" : "Bank"}>
          <InstitutionCombobox
            id={ids.bank}
            institutions={data.institutions.map((one) => one.name)}
            value={draft.institution}
            onChange={(name) => update(withInstitution(draft, name, data))}
            empty="Type the bank's name."
          />
        </Field>
      )}
      {!existing && (
        <Field id={ids.name} label="Name">
          <Input
            id={ids.name}
            value={draft.name}
            onChange={(event) => update(withName(draft, event.target.value))}
            className="h-sap-ctl rounded-control"
          />
        </Field>
      )}
      {groupInView && group}
      {moreOptions.length > 0 && (
        <Disclosure
          summary="More options"
          open={moreOpen || existing}
          onOpenChange={setMoreOpen}
        >
          {moreOptions.map((field, i) => (
            <div key={i}>{field}</div>
          ))}
        </Disclosure>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-row font-semibold text-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
