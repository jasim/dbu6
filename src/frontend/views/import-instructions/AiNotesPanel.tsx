import { useId } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { apiErrorMessage } from "../../api";
import { CopyButton } from "../../components/agent-prompt";
import { LoadError } from "../../components/load-error";
import { accountInstructionsQuery } from "../../queries";
import type { PresetAccount } from "../categorization/CategorizationInstructions";
import { fileUsers, otherUsers, sameNotes } from "./file-users";
import { EditFooter, HowItWorks, TabList } from "./rule-parts";

/*
 * The AI tab: for whatever the rules miss, the notes the AI reads for each
 * bank or card, as the files have them. The notes are free text; nothing
 * here reads meaning into them. A bank or card whose notes name a file
 * user-config/ doesn't have says so on its tab, since the AI then goes
 * without it. Read-only; the files are edited in user-config/.
 */
export function AiNotesPanel({
  accounts,
  names,
  chosen,
  onChoose,
}: {
  accounts: readonly PresetAccount[];
  names: ReadonlyMap<number, string>;
  chosen: PresetAccount | null;
  onChoose: (accountId: number) => void;
}) {
  const baseId = useId();
  const tabId = (id: string) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;
  const files = chosen?.account.custom_mappings_filenames ?? [];
  // Each account's notes, read to find those missing a file; the chosen
  // one's is the same query Notes shows.
  const notes = useQueries({
    queries: accounts.map(({ account }) => ({
      ...accountInstructionsQuery(account.account_id),
      enabled: account.custom_mappings_filenames.length > 0,
    })),
  });
  const missingFile = (index: number) =>
    notes[index]?.data?.files.some((file) => file.content === null) ?? false;

  return (
    <>
      <HowItWorks
        title="Everything else: the AI decides"
        detail="It reads your notes for the bank or card, and your account names. When it isn't sure, the transaction waits for you in Drafts."
      />
      {chosen === null ? (
        <p className="mt-7 text-body text-ink-soft">
          No banks or cards yet. The AI goes by your account names.
        </p>
      ) : (
        <section className="mt-7">
          <h3 className="mb-2 text-subheading text-foreground">
            Your notes to the AI
          </h3>
          <TabList
            label="Whose notes"
            tabs={accounts.map(({ account }, index) => ({
              id: String(account.account_id),
              label: names.get(account.account_id) ?? account.name,
              note:
                account.custom_mappings_filenames.length === 0
                  ? "none"
                  : missingFile(index)
                    ? "file missing"
                    : undefined,
              noteAttention: missingFile(index),
            }))}
            selected={String(chosen.account.account_id)}
            onSelect={(id) => onChoose(Number(id))}
            tabId={tabId}
            panelId={panelId}
          />
          <div
            role="tabpanel"
            id={panelId}
            aria-labelledby={tabId(String(chosen.account.account_id))}
            className="space-y-3 pt-4"
          >
            <Notes
              // Another account's notes start afresh.
              key={chosen.account.account_id}
              accounts={accounts}
              names={names}
              chosen={chosen}
            />
          </div>
        </section>
      )}
      <EditFooter
        file={files.length === 1 ? files[0]! : "custom_mappings_*.prompt"}
      />
    </>
  );
}

function Notes({
  accounts,
  names,
  chosen,
}: {
  accounts: readonly PresetAccount[];
  names: ReadonlyMap<number, string>;
  chosen: PresetAccount;
}) {
  const { account } = chosen;
  const name = names.get(account.account_id) ?? account.name;
  const instructions = useQuery({
    ...accountInstructionsQuery(account.account_id),
    enabled: account.custom_mappings_filenames.length > 0,
  });
  const nameOf = (one: PresetAccount) =>
    names.get(one.account.account_id) ?? one.account.name;
  const same = sameNotes(accounts, chosen);
  const users = fileUsers(accounts);

  return (
    <>
      {account.ledger_account_name === null && (
        <p className="text-body text-ink-soft">
          Not in your books any more, so nothing imports into it.
        </p>
      )}
      {account.custom_mappings_filenames.length === 0 ? (
        <p className="text-body text-ink-soft">
          No notes for {name}. The AI goes by your account names.
        </p>
      ) : instructions.isError ? (
        <LoadError
          title="Couldn't read the notes"
          message={apiErrorMessage(instructions.error)}
          retry={() => void instructions.refetch()}
        />
      ) : !instructions.data ? (
        <p className="text-body text-ink-soft">Reading the notes…</p>
      ) : (
        <>
          {instructions.data.files.map((file, _, files) => {
            // Several files each carry their name.
            const labelled = files.length > 1;
            // Who else lists this file, when not everyone "Same notes as"
            // already names.
            const also = otherUsers(users, file.filename, account.account_id)
              .filter((one) => !same.includes(one))
              .map(nameOf);
            return (
              <div key={file.filename} className="space-y-1">
                {labelled && (
                  <p className="font-mono text-meta text-ink-soft [overflow-wrap:anywhere]">
                    {file.filename}
                    {also.length > 0 && (
                      <span className="font-sans">
                        {" "}
                        · also for {also.join(", ")}
                      </span>
                    )}
                  </p>
                )}
                {file.content === null ? (
                  <p className="text-body text-attention-ink">
                    {labelled ? (
                      "Not"
                    ) : (
                      <>
                        <code className="font-mono">{file.filename}</code> isn't
                      </>
                    )}{" "}
                    in user-config/, so the AI doesn't get it.
                  </p>
                ) : (
                  <div className="max-w-[80ch] whitespace-pre-wrap rounded-card border border-sap-border bg-card px-5 py-4 text-body leading-relaxed text-foreground shadow-card [overflow-wrap:anywhere]">
                    {file.content}
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex max-w-[80ch] flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="text-meta text-ink-soft">
              {same.length > 0 &&
                `Same notes as ${same.map(nameOf).join(", ")}`}
            </p>
            {instructions.data.text !== "" && (
              <CopyButton text={instructions.data.text} label="Copy" />
            )}
          </div>
        </>
      )}
    </>
  );
}
