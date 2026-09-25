import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiErrorMessage } from "../../api";
import { CopyButton } from "../../components/agent-prompt";
import { LoadError } from "../../components/load-error";
import { accountInstructionsQuery, chartOfAccountsQuery } from "../../queries";
import type { PresetAccount } from "../categorization/CategorizationInstructions";
import { fileUsers, otherUsers, sameNotes } from "./file-users";
import { aiExample } from "./mapping-rules";
import { EditFooter, PanelHead, TabList } from "./rule-parts";

/*
 * The AI tab: for whatever the rules miss, the notes the AI reads for each
 * bank or card, as the files have them. The notes are free text; nothing
 * here reads meaning into them. Read-only; the files are edited in
 * user-config/.
 */
export function AiNotesPanel({
  accounts,
  names,
  chosen,
  onChoose,
  teachHref,
}: {
  accounts: readonly PresetAccount[];
  names: ReadonlyMap<number, string>;
  chosen: PresetAccount | null;
  onChoose: (accountId: number) => void;
  teachHref: string | null;
}) {
  const chart = useQuery(chartOfAccountsQuery);
  const ledger =
    chart.data?.state === "existing" ? chart.data.chart.accounts : [];
  const baseId = useId();
  const tabId = (id: string) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;
  const files = chosen?.account.custom_mappings_filenames ?? [];

  return (
    <>
      <PanelHead
        example={aiExample(ledger)}
        caption="For whatever the rules miss, the AI reads these notes. When it isn't sure, you choose in Drafts."
      />
      {chosen === null ? (
        <p className="text-body text-ink-meta">
          No banks or cards yet. The AI goes by your account names.
        </p>
      ) : (
        <>
          <TabList
            label="Whose notes"
            tabs={accounts.map(({ account }) => ({
              id: String(account.account_id),
              label: names.get(account.account_id) ?? account.name,
              note:
                account.custom_mappings_filenames.length === 0
                  ? "none"
                  : undefined,
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
            className="space-y-2.5 pt-3.5"
          >
            <Notes
              // Another account's notes start afresh.
              key={chosen.account.account_id}
              accounts={accounts}
              names={names}
              chosen={chosen}
            />
          </div>
        </>
      )}
      <EditFooter
        file={files.length === 1 ? files[0]! : "custom_mappings_*.prompt"}
        teachHref={teachHref}
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
        <p className="text-meta text-ink-meta">
          Not in your books any more, so nothing imports into it.
        </p>
      )}
      {account.custom_mappings_filenames.length === 0 ? (
        <p className="text-body text-ink-meta">
          No notes for {name}. The AI goes by your account names.
        </p>
      ) : instructions.isError ? (
        <LoadError
          title="Couldn't read the notes"
          message={apiErrorMessage(instructions.error)}
          retry={() => void instructions.refetch()}
        />
      ) : !instructions.data ? (
        <p className="text-meta text-ink-meta">Reading the notes…</p>
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
                  <p className="font-mono text-label font-normal tracking-normal text-ink-meta [overflow-wrap:anywhere]">
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
                  <p className="text-meta text-ink-meta">
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
                  <div className="max-w-[78ch] whitespace-pre-wrap rounded-control bg-sap-nested px-4 py-3.5 text-body leading-relaxed text-foreground [overflow-wrap:anywhere]">
                    {file.content}
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex max-w-[78ch] flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="text-meta text-ink-meta">
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
