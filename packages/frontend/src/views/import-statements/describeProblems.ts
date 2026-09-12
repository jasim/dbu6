import type {
  AutoImportFailedGroup,
  AutoImportGroupResult,
  AutoImportPlanFile,
} from "dbu6-shared";
import {
  ambiguousPrompt,
  balanceMismatchPrompt,
  boundaryGapPrompt,
  closingBalancePrompt,
  disagreementPrompt,
  genericFailurePrompt,
  identifierMismatchPrompt,
  identifierRequiredPrompt,
  noPresetPrompt,
  openingBalancePrompt,
  partInvalidPrompt,
  reconciliationPrompt,
  unrecognizedPrompt,
  type FailedGroupFacts,
} from "./agentPrompts";
import type { Stat } from "./describeGroup";
import {
  formatDate,
  formatMoney,
  joinNames,
  maskIdentifier,
  parserLabel,
} from "./format";

// A failed automatic import as the endpoint reports it. `files` and
// `importedGroups` are present whenever the server got far enough to decide
// them; `failedGroup` names the account whose import raised the error; every
// other field of the body is kept in `fields` for the code-specific cards.
export interface AutoImportError {
  status: number;
  error: string;
  message: string | null;
  hint: string | null;
  detail: string | null;
  partialImport: string | null;
  files: AutoImportPlanFile[];
  importedGroups: AutoImportGroupResult[];
  failedGroup: AutoImportFailedGroup | null;
  fields: Record<string, unknown>;
}

export function parseErrorBody(body: unknown, status: number): AutoImportError {
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const str = (key: string) =>
    typeof record[key] === "string" ? (record[key] as string) : null;
  const list = <T>(key: string): T[] =>
    Array.isArray(record[key]) ? (record[key] as T[]) : [];
  const failed = record.failed_group;
  return {
    status,
    error: str("error") ?? `HTTP ${status}`,
    message: str("message"),
    hint: str("hint"),
    detail: str("detail"),
    partialImport: str("partial_import"),
    files: list<AutoImportPlanFile>("files"),
    importedGroups: list<AutoImportGroupResult>("imported_groups"),
    failedGroup:
      failed && typeof failed === "object"
        ? (failed as AutoImportFailedGroup)
        : null,
    fields: record,
  };
}

export function networkError(message: string): AutoImportError {
  return {
    status: 0,
    error: "upload_failed",
    message,
    hint: null,
    detail: null,
    partialImport: null,
    files: [],
    importedGroups: [],
    failedGroup: null,
    fields: {},
  };
}

// Something the screen can do by itself, offered as a button.
export type ProblemAction =
  | { kind: "remove-files"; label: string; fileNames: string[] }
  | { kind: "keep-only-files"; label: string; fileNames: string[] }
  | { kind: "link"; label: string; to: string };

export interface AgentHandoff {
  prompt: string;
  // What the user does once the agent reports back.
  afterwards: string;
}

export interface Problem {
  key: string;
  fileNames: string[];
  // Whose statement: the account, the institution, or failing both, the
  // file. The card's title.
  subject: string;
  // The files involved, or the account number, under the title. Null when
  // the subject already says it all.
  caption: string | null;
  // The one sentence that says what went wrong.
  verdict: string;
  // The numbers and names behind the verdict, as a label/value table.
  facts: Stat[];
  // The likely cause, in a sentence or two.
  why: string;
  // Plain advice the user can act on without the app's help.
  steps: string[];
  actions: ProblemAction[];
  agent: AgentHandoff | null;
  // The server's own words, for the disclosure at the bottom of the card.
  technical: string | null;
}

const RETRY_FROM_SCREEN =
  "When the agent says it is done, press Process again with the same files.";
const REDROP_FILE =
  "When the agent says the reader is done, come back here, drop this file again, and press Process.";

function num(fields: Record<string, unknown>, key: string): number | null {
  return typeof fields[key] === "number" ? (fields[key] as number) : null;
}

function text(fields: Record<string, unknown>, key: string): string | null {
  return typeof fields[key] === "string" ? (fields[key] as string) : null;
}

function technical(error: AutoImportError): string {
  return [error.error, error.message, error.detail, error.hint]
    .filter((part): part is string => part !== null && part !== "")
    .join("\n");
}

// One card per file the plan could not place. Nothing was imported.
function planProblems(error: AutoImportError): Problem[] {
  const problems: Problem[] = [];
  for (const row of error.files) {
    switch (row.status) {
      case "resolved":
        break;
      case "unrecognized": {
        const tried = row.candidate_parser_paths;
        problems.push({
          key: `unrecognized:${row.file_name}`,
          fileNames: [row.file_name],
          subject: row.file_name,
          caption: null,
          verdict: "The app can't read this file yet.",
          facts: [
            {
              label: "Readers tried",
              value:
                tried.length === 0
                  ? "none fit this file type"
                  : tried.map(parserLabel).join(", "),
            },
          ],
          why: `Each bank's statements are read by a reader written for that bank's exact file layout, and none matches this file. Nothing was imported, including the other files, so you can fix this and process everything together.`,
          steps: [],
          actions: [
            {
              kind: "remove-files",
              label: "Remove this file and process the rest",
              fileNames: [row.file_name],
            },
          ],
          agent: {
            prompt: unrecognizedPrompt({
              fileName: row.file_name,
              candidateParserPaths: tried,
            }),
            afterwards: REDROP_FILE,
          },
          technical: technical(error),
        });
        break;
      }
      case "ambiguous":
        problems.push({
          key: `ambiguous:${row.file_name}`,
          fileNames: [row.file_name],
          subject: row.file_name,
          caption: null,
          verdict: "More than one reader claims this file.",
          facts: [
            {
              label: "Readers",
              value: row.matching_parser_paths.map(parserLabel).join(", "),
            },
          ],
          why: "The app can't tell which reader to trust. This is a problem in the readers, not in your file.",
          steps: [],
          actions: [
            {
              kind: "remove-files",
              label: "Remove this file and process the rest",
              fileNames: [row.file_name],
            },
          ],
          agent: {
            prompt: ambiguousPrompt({
              fileName: row.file_name,
              matchingParserPaths: row.matching_parser_paths,
            }),
            afterwards: RETRY_FROM_SCREEN,
          },
          technical: technical(error),
        });
        break;
      case "unresolved":
        problems.push(unresolvedProblem(row, error));
        break;
    }
  }
  return problems;
}

function unresolvedProblem(
  row: Extract<AutoImportPlanFile, { status: "unresolved" }>,
  error: AutoImportError,
): Problem {
  const account = row.account
    ? `${row.account.kind === "card" ? "card" : "account"} ${maskIdentifier(row.account.identifier)}`
    : null;
  const accountFact: Stat[] = account
    ? [{ label: "Statement is for", value: account }]
    : [];
  const readerFact: Stat = {
    label: "Reader",
    value: parserLabel(row.parser_path),
  };
  const candidates = joinNames(row.candidate_preset_names);
  const base = {
    fileNames: [row.file_name],
    subject: row.institution ?? row.file_name,
    caption:
      [row.institution === null ? null : row.file_name, account]
        .filter((part): part is string => part !== null)
        .join(" · ") || null,
    technical: `${row.message}\n${technical(error)}`,
    actions: [
      {
        kind: "remove-files" as const,
        label: "Remove this file and process the rest",
        fileNames: [row.file_name],
      },
    ],
  };
  switch (row.reason) {
    case "no_preset_for_parser":
      return {
        ...base,
        key: `no-preset:${row.file_name}`,
        verdict: "No account is set up to receive this statement.",
        facts: [...accountFact, readerFact],
        why: "The app could read the statement, but it doesn't know which of your accounts it belongs to. Each account that receives statements needs to be set up once.",
        steps: [],
        agent: {
          prompt: noPresetPrompt({
            fileName: row.file_name,
            parserPath: row.parser_path,
            institution: row.institution,
            identifier: row.account?.identifier ?? null,
            kind: row.account?.kind ?? null,
          }),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    case "statement_account_identifier_required":
      return {
        ...base,
        key: `identifier-required:${row.file_name}`,
        verdict: "The app can't tell which of your accounts this belongs to.",
        facts: [
          { label: "Set up for these statements", value: candidates },
          readerFact,
        ],
        why: `${candidates} ${row.candidate_preset_names.length === 1 ? "is" : "are"} set up to check the account number printed on the statement, but the reader didn't report one. This needs a small fix to the reader or to the account's setup.`,
        steps: [],
        agent: {
          prompt: identifierRequiredPrompt({
            fileName: row.file_name,
            parserPath: row.parser_path,
            candidatePresetNames: row.candidate_preset_names,
            message: row.message,
          }),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    case "statement_account_identifier_mismatch":
      return {
        ...base,
        key: `identifier-mismatch:${row.file_name}`,
        verdict:
          "This statement is for a different account than the one set up.",
        facts: [
          ...accountFact,
          { label: "Set up for these statements", value: candidates },
        ],
        why: `${candidates} ${row.candidate_preset_names.length === 1 ? "has" : "have"} a different account number. Either this is a statement for an account you haven't set up yet, or it was dropped here by mistake.`,
        steps: [],
        actions: [
          {
            kind: "remove-files",
            label: "Remove this file, it was dropped by mistake",
            fileNames: [row.file_name],
          },
        ],
        agent: {
          prompt: identifierMismatchPrompt({
            fileName: row.file_name,
            parserPath: row.parser_path,
            identifier: row.account?.identifier ?? null,
            candidatePresetNames: row.candidate_preset_names,
            message: row.message,
          }),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
  }
}

function groupFacts(error: AutoImportError): FailedGroupFacts {
  const group = error.failedGroup;
  const fileNames = group?.file_names ?? [];
  const parserPaths = Array.from(
    new Set(
      error.files
        .filter(
          (row): row is Extract<AutoImportPlanFile, { status: "resolved" }> =>
            row.status === "resolved" && fileNames.includes(row.file_name),
        )
        .map((row) => row.parser_path),
    ),
  );
  return {
    fileNames,
    presetName: group?.preset_name ?? "this account",
    baseAccount: group?.base_account ?? "(unknown)",
    parserPaths,
    message: error.message,
  };
}

// One card for the account whose import failed.
function groupProblem(error: AutoImportError): Problem {
  const facts = groupFacts(error);
  const f = error.fields;
  const files = joinNames(facts.fileNames);
  const base = {
    key: `${error.error}:${facts.presetName}`,
    fileNames: [...facts.fileNames],
    subject: facts.presetName,
    caption: facts.fileNames.length === 0 ? null : files,
    facts: [] as Stat[],
    technical: technical(error),
    steps: [] as string[],
    actions: [] as ProblemAction[],
  };

  switch (error.error) {
    case "balance_mismatch": {
      const computed = num(f, "computed_final");
      const closing = num(f, "statement_closing");
      const difference = num(f, "difference");
      const gap = error.hint !== null || facts.fileNames.length > 1;
      return {
        ...base,
        verdict:
          "The transactions don't add up to the closing balance the statement prints.",
        facts:
          computed !== null && closing !== null && difference !== null
            ? [
                {
                  label: "Opening plus every transaction",
                  value: formatMoney(computed),
                },
                {
                  label: "Closing the statement prints",
                  value: formatMoney(closing),
                },
                { label: "Difference", value: formatMoney(difference) },
              ]
            : [],
        why: gap
          ? "This usually means there is a gap: some days between the statements are missing, or a statement is incomplete."
          : "This usually means one row was read wrongly.",
        steps: gap
          ? [
              "Check that the statements you dropped cover the whole period with no days missing, add the missing one, and press Process again.",
            ]
          : [],
        agent: {
          prompt: balanceMismatchPrompt({
            ...facts,
            computedFinal: computed,
            statementClosing: closing,
            difference,
            suspectRange: null,
          }),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    }
    case "segment_balance_mismatch": {
      const fromDate = text(f, "from_date") ?? "?";
      const toDate = text(f, "to_date") ?? "?";
      const fromBalance = num(f, "from_balance");
      const walked = num(f, "walked");
      const printed = num(f, "printed");
      return {
        ...base,
        verdict: `The running balance doesn't match the transactions between ${formatDate(fromDate)} and ${formatDate(toDate)}.`,
        facts:
          fromBalance !== null && walked !== null && printed !== null
            ? [
                {
                  label: `Printed on ${formatDate(fromDate)}`,
                  value: formatMoney(fromBalance),
                },
                {
                  label: `Transactions lead to, on ${formatDate(toDate)}`,
                  value: formatMoney(walked),
                },
                {
                  label: `Printed on ${formatDate(toDate)}`,
                  value: formatMoney(printed),
                },
              ]
            : [],
        why: "Almost always a row in between was read wrongly by the reader.",
        agent: {
          prompt: balanceMismatchPrompt({
            ...facts,
            computedFinal: walked,
            statementClosing: printed,
            difference: num(f, "difference"),
            suspectRange: { fromDate, toDate },
          }),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    }
    case "statement_boundary_mismatch": {
      const earlier = text(f, "earlier_source") ?? "the earlier file";
      const later = text(f, "later_source") ?? "the later file";
      const earlierClosing = num(f, "earlier_closing");
      const laterOpening = num(f, "later_opening");
      const difference = num(f, "difference");
      if (error.hint !== null) {
        return {
          ...base,
          verdict: `${later} looks like the same statement as ${earlier}.`,
          why: "Both cover the same dates and start and end at the same balances, so one of them is a duplicate download.",
          actions: [
            {
              kind: "remove-files",
              label: `Remove ${later} and process again`,
              fileNames: [later],
            },
          ],
          agent: null,
        };
      }
      return {
        ...base,
        verdict: `There is a gap between ${earlier} and ${later}.`,
        facts:
          earlierClosing !== null &&
          laterOpening !== null &&
          difference !== null
            ? [
                {
                  label: `${earlier} ends at`,
                  value: formatMoney(earlierClosing),
                },
                {
                  label: `${later} begins at`,
                  value: formatMoney(laterOpening),
                },
                {
                  label: "Activity in neither file",
                  value: formatMoney(Math.abs(difference)),
                },
              ]
            : [],
        why: "The earlier file ends at a different balance than the later one begins with, so activity between them is missing from both. Usually a statement for the period in between is missing.",
        steps: [
          "Download the statement for the missing period, add it here, and press Process again.",
          `Or process ${earlier} on its own now and the rest later, in date order.`,
        ],
        actions: [
          {
            kind: "keep-only-files",
            label: `Process ${earlier} on its own`,
            fileNames: [earlier],
          },
        ],
        agent: {
          prompt: boundaryGapPrompt({
            ...facts,
            earlierSource: earlier,
            laterSource: later,
            earlierClosing,
            laterOpening,
            difference,
          }),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    }
    case "statement_disagreement": {
      const parts = Array.isArray(f.parts) ? (f.parts as string[]) : [];
      const date = text(f, "date") ?? "?";
      const row =
        f.row && typeof f.row === "object"
          ? (f.row as Record<string, unknown>)
          : {};
      const narration = typeof row.narration === "string" ? row.narration : "";
      const amount =
        typeof row.deposit === "number" && row.deposit > 0
          ? `deposit ${formatMoney(row.deposit)}`
          : typeof row.withdrawal === "number"
            ? `withdrawal ${formatMoney(row.withdrawal)}`
            : "";
      return {
        ...base,
        verdict: `${joinNames(parts)} both include ${formatDate(date)} but list it differently.`,
        facts: [
          { label: "Day in both files", value: formatDate(date) },
          ...(narration
            ? [
                {
                  label: "First row that differs",
                  value: amount ? `${narration} (${amount})` : narration,
                },
              ]
            : []),
        ],
        why: "This happens when two downloads overlap and one of them was taken before the bank finalised that day.",
        steps: [
          "Download the statements again so their dates don't overlap, or keep only the one you trust for that day, then press Process again.",
        ],
        actions: parts.map((part) => ({
          kind: "remove-files" as const,
          label: `Remove ${part}`,
          fileNames: [part],
        })),
        agent: {
          prompt: disagreementPrompt({
            ...facts,
            date,
            parts,
            row: JSON.stringify(row),
          }),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    }
    case "statement_part_unjoinable": {
      const part = text(f, "part") ?? "one of the files";
      return {
        ...base,
        verdict: `${part} prints no balances, so it can't be placed next to the other files.`,
        why: "Without an opening, closing, or running balance the app can't tell where this file fits in the sequence. It can still be imported on its own.",
        steps: [`Process ${part} by itself, then the other files afterwards.`],
        actions: [
          {
            kind: "keep-only-files",
            label: `Process ${part} on its own`,
            fileNames: [part],
          },
        ],
        agent: null,
      };
    }
    case "statement_part_invalid": {
      const part = text(f, "part") ?? "one of the files";
      return {
        ...base,
        verdict: `${part} contradicts itself.`,
        facts: error.detail ? [{ label: "Detail", value: error.detail }] : [],
        why: "Its own opening or closing balance doesn't match its rows. Either the bank's export is broken or the reader misread it.",
        agent: {
          prompt: partInvalidPrompt({ ...facts, part, detail: error.detail }),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    }
    case "reconciliation_match_failed": {
      const date = text(f, "checkpoint_date");
      const balance = num(f, "checkpoint_balance");
      return {
        ...base,
        verdict: "The statement doesn't line up with your books.",
        facts: [
          ...(date
            ? [{ label: "Books last confirmed on", value: formatDate(date) }]
            : []),
          ...(balance !== null
            ? [{ label: "Confirmed balance", value: formatMoney(balance) }]
            : []),
        ],
        why: "The statement has rows on that day, but none of them shows the confirmed balance, so the app can't tell which transactions are new. Either your books and the bank have drifted apart, or the statement is missing a row on that day.",
        agent: {
          prompt: reconciliationPrompt({
            ...facts,
            checkpointDate: date,
            checkpointBalance: balance,
          }),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    }
    case "opening_balance_unavailable":
      return {
        ...base,
        verdict: "The app needs a starting balance for this account.",
        why: "This statement doesn't print running balances or an opening balance, and your books don't have a confirmed balance for this account yet. This only happens the first time an account is imported.",
        steps: [
          "Use the manual import screen and type the opening balance printed on the statement.",
        ],
        actions: [
          {
            kind: "link",
            label: "Open the manual import screen",
            to: "/views/import-statement",
          },
        ],
        agent: {
          prompt: openingBalancePrompt(facts),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    case "closing_balance_unavailable":
      return {
        ...base,
        verdict: "The app needs the closing balance for this card.",
        why: "This card statement doesn't print a total amount owed that the app can find, so it can't check the import against the bank.",
        steps: [
          "Use the manual import screen and type the closing amount printed on the statement.",
        ],
        actions: [
          {
            kind: "link",
            label: "Open the manual import screen",
            to: "/views/import-statement",
          },
        ],
        agent: {
          prompt: closingBalancePrompt(facts),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    case "assertion_conflict": {
      const date = text(f, "date");
      return {
        ...base,
        verdict:
          "Your books already have a different confirmed balance for that day.",
        facts: date ? [{ label: "Day", value: formatDate(date) }] : [],
        why: "The statement's closing balance for that day doesn't match the balance already recorded as confirmed in your books.",
        agent: {
          prompt: genericFailurePrompt({
            ...facts,
            code: error.error,
            payload: JSON.stringify(f, null, 2),
          }),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    }
    case "llm_extraction_failed":
      return {
        ...base,
        verdict: "The categorisation service didn't respond.",
        why: "Nothing from this account was imported. This is usually temporary.",
        steps: ["Wait a minute and press Process again."],
        agent: null,
      };
    default:
      return {
        ...base,
        verdict: "The import stopped with an unexpected error.",
        why: error.message ?? "The server gave no further explanation.",
        agent: {
          prompt: genericFailurePrompt({
            ...facts,
            code: error.error,
            payload: JSON.stringify(f, null, 2),
          }),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
  }
}

export function describeProblems(error: AutoImportError): Problem[] {
  if (error.error === "auto_import_files_unresolved") {
    return planProblems(error);
  }
  if (error.status === 403) {
    return [
      {
        key: "forbidden",
        fileNames: [],
        subject: "Your sign-in",
        caption: null,
        verdict: "You don't have permission to import.",
        facts: [],
        why: "Sign in with an account that manages these books, then try again.",
        steps: [],
        actions: [],
        agent: null,
        technical: technical(error),
      },
    ];
  }
  if (error.error === "upload_failed" || error.status === 0) {
    return [
      {
        key: "upload-failed",
        fileNames: [],
        subject: "Connection",
        caption: null,
        verdict: "The files could not be sent.",
        facts: [],
        why: "The app's server didn't answer. Check that it is running and that you are online, then press Process again.",
        steps: [],
        actions: [],
        agent: null,
        technical: technical(error),
      },
    ];
  }
  return [groupProblem(error)];
}
