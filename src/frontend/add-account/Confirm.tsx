import { useId, useState } from "react";
import { Input } from "@sapporta/ui";
import type {
  AccountKind,
  AddAccountCandidate,
  AddAccountFields,
  LlmStatus,
  StatementAccounts,
} from "../../shared/index";
import { Disclosure } from "../components/disclosure";
import { FactTable, type Fact } from "../components/fact-table";
import { Button } from "../components/ui/button";
import { formatBalance, formatDate } from "../format";
import {
  AccountCombobox,
  InstitutionCombobox,
} from "../components/account-pickers";
import {
  confirmDraft,
  confirmLayout,
  readConfirm,
  unlistedOf,
  withInstitution,
  withName,
  type ConfirmDraft,
} from "./confirm-form";
import { Field, FocusCard, type FocusFrame } from "../components/focus-card";
import { Importing, newProgressId } from "./Importing";
import type { Opening } from "./state";
import { bankLine, categorizerFact, periodSpan } from "./words";

/**
 * Card 4: what dbu6 read, as facts, and the account it goes into. The
 * account is written here and nowhere earlier, with its files imported and
 * categorized; while that runs the card gives way to Importing, and a
 * refusal brings it back, as it was, with one line under the button.
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
  onAdd: (fields: AddAccountFields, progressId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => confirmDraft(account, kind, data));
  const [problem, setProblem] = useState<string | null>(null);
  // The running add's progress id; null when none runs.
  const [adding, setAdding] = useState<string | null>(null);
  const fixed = account.account;

  async function add() {
    const read = readConfirm(account, kind, opening, draft, data);
    if (!read.ok) {
      setProblem(read.problem);
      return;
    }
    setProblem(null);
    const progressId = newProgressId();
    setAdding(progressId);
    try {
      await onAdd(read.fields, progressId);
    } finally {
      setAdding(null);
    }
  }

  const update = (next: ConfirmDraft) => {
    setDraft(next);
    setProblem(null);
  };
  const said = problem ?? refusal;
  const title = fixed ? fixed.name : bankLine(account, kind);

  if (adding !== null) {
    return (
      <Importing
        frame={frame}
        progressId={adding}
        name={fixed?.name ?? accountName(draft, data)}
        facts={[
          ...destinationFacts(account, kind, draft, data),
          ...statementFacts(account),
        ]}
        categorizer={categorizer}
      />
    );
  }

  return (
    <FocusCard
      {...frame}
      title={title}
      lead={fixed ? bankLine(account, kind) : undefined}
      actions={
        <div className="flex flex-col items-end gap-2">
          <Button onClick={() => void add()}>Add to books</Button>
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
      <FactTable
        rows={[
          ...statementFacts(account),
          balanceFact(opening, kind),
          categorizerRow(categorizer),
        ]}
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

/** What the statements hold: their months and their rows. */
function statementFacts(account: AddAccountCandidate): Fact[] {
  const span = periodSpan(account);
  return [
    ...(span === null ? [] : [{ label: "Statements", value: span }]),
    { label: "Transactions", value: String(account.transactions) },
  ];
}

/** Where the balances start, or that the statements' own add up. */
function balanceFact(opening: Opening, kind: AccountKind): Fact {
  switch (opening.from) {
    case "typed":
      return {
        label: "Opening balance",
        value: `${formatBalance(opening.amount, kind)} on ${formatDate(opening.date)}`,
      };
    case "books":
      return {
        label: "Opening balance",
        value: "From your books",
        face: "words",
      };
    default:
      return { label: "Balances", value: "Add up", face: "words", tone: "ok" };
  }
}

function categorizerRow(categorizer: LlmStatus): Fact {
  return {
    label: "Categorizer",
    value: categorizerFact(categorizer),
    face: "words",
    tone: categorizer.ready ? undefined : "attention",
  };
}

/** The account the add writes to, as the importing card recalls it. */
function destinationFacts(
  account: AddAccountCandidate,
  kind: AccountKind,
  draft: ConfirmDraft,
  data: StatementAccounts,
): Fact[] {
  const bank = account.institution_listed
    ? account.institution
    : draft.institution.trim();
  const facts: Fact[] =
    bank === ""
      ? []
      : [
          {
            label: kind === "card" ? "Card issuer" : "Bank",
            value: bank,
            face: "words",
          },
        ];
  if (account.account !== null || draft.existingId !== null) return facts;
  const parent = data.parents[kind].find((one) => one.id === draft.parentId);
  return parent === undefined
    ? facts
    : [
        ...facts,
        { label: "Parent account", value: parent.name, face: "words" },
      ];
}

/** The name the new account gets, or the existing one it goes into. */
function accountName(draft: ConfirmDraft, data: StatementAccounts): string {
  if (draft.existingId === null) return draft.name.trim();
  const existing = data.unlisted.find((one) => one.id === draft.existingId);
  return existing?.name ?? draft.name.trim();
}

/**
 * The new account's bank (when dbu6 hasn't met it), name and parent
 * account; under More options, an existing account from the chart to use
 * instead of a new one.
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
  draft: ConfirmDraft;
  data: StatementAccounts;
  update: (draft: ConfirmDraft) => void;
}) {
  const ids = {
    name: useId(),
    bank: useId(),
    parent: useId(),
    existing: useId(),
  };
  const layout = confirmLayout(account, kind, data);
  const existing = draft.existingId !== null;
  const [moreOpen, setMoreOpen] = useState(false);

  const parent = (
    <Field
      id={ids.parent}
      label="Parent account"
      aside={layout.parentOptional ? "optional" : undefined}
    >
      <AccountCombobox
        id={ids.parent}
        choices={data.parents[kind]}
        value={draft.parentId}
        onChange={(parentId) => update({ ...draft, parentId })}
        placeholder="Pick an account"
      />
    </Field>
  );
  const parentInView = layout.parentInView && !existing;
  const moreOptions = [
    !parentInView && !existing && parent,
    layout.canUseExisting && (
      <Field id={ids.existing} label="Use an existing account">
        <AccountCombobox
          id={ids.existing}
          choices={unlistedOf(data, kind)}
          value={draft.existingId}
          onChange={(existingId) => update({ ...draft, existingId })}
          placeholder="No, add a new one"
        />
      </Field>
    ),
  ].filter(Boolean);

  return (
    <div className="mt-6 space-y-4">
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
      {parentInView && parent}
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
