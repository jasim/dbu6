import type {
  AutoImportPlanFile,
  StatementImportError,
  StatementImportErrorCode,
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
} from "./agentPrompts";
import type { StatusTone } from "../../components/status-chip";
import type { Stat } from "./describeGroup";
import type { AccountRefusal, ImportFailure } from "./outcome";
import {
  describeStatementAccount,
  formatDate,
  formatMoney,
  joinNames,
  parserLabel,
} from "../../format";

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

// How serious a problem is. Destructive ("problem") when the numbers don't
// add up; attention when something needs setting up.
export type ProblemTone = Extract<StatusTone, "problem" | "attention">;

export interface Problem {
  key: string;
  tone: ProblemTone;
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

// How serious each statement import error is. Destructive when the numbers
// don't add up; attention when something needs setting up. The codes without
// a card of their own take the unexpected-error card, destructive too.
const STATEMENT_ERROR_TONE: Record<StatementImportErrorCode, ProblemTone> = {
  balance_mismatch: "problem",
  segment_balance_mismatch: "problem",
  statement_boundary_mismatch: "problem",
  statement_disagreement: "problem",
  statement_part_invalid: "problem",
  reconciliation_match_failed: "problem",
  assertion_conflict: "problem",
  opening_balance_unavailable: "attention",
  closing_balance_unavailable: "attention",
  statement_part_unjoinable: "attention",
  ambiguous_duplicate: "problem",
  abacus_json_parse_failed: "problem",
  categorization_config_error: "problem",
};

export function problemTone(failure: ImportFailure): ProblemTone {
  switch (failure.kind) {
    case "network":
    case "unexpected":
      return "problem";
    case "forbidden":
    case "files-unresolved":
      // A file that is unrecognised, ambiguous, or has no account set up.
      return "attention";
    case "account-refused":
      return STATEMENT_ERROR_TONE[failure.refusal.error];
  }
}

export const FREEFORM_IMPORT_ROUTE = "/views/import-freeform-transactions";

const RETRY_FROM_SCREEN =
  "When the agent says it is done, import the same files again.";
const REDROP_FILE =
  "When the agent says the reader is done, come back here, drop this file again, and import it.";

// A problem before the tone its error gives every card.
type ProblemBody = Omit<Problem, "tone">;

// The server's own words: the code, its message, and any detail or hint.
function technical(error: StatementImportError): string {
  const detail = "detail" in error ? error.detail : undefined;
  const hint = "hint" in error ? error.hint : undefined;
  return [error.error, error.message, detail, hint]
    .filter((part): part is string => part !== undefined && part !== "")
    .join("\n");
}

// One card per file the plan could not place. Nothing was imported.
function planProblems(
  failure: Extract<ImportFailure, { kind: "files-unresolved" }>,
): ProblemBody[] {
  const planTechnical = [
    "auto_import_files_unresolved",
    failure.message,
    failure.hint,
  ].join("\n");
  const problems: ProblemBody[] = [];
  for (const row of failure.files) {
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
            tried.length === 0
              ? {
                  label: "Readers tried",
                  value: "none fit this file type",
                  face: "words",
                }
              : {
                  label: "Readers tried",
                  value: tried.map(parserLabel).join(", "),
                },
          ],
          why: `Each bank's statements are read by a reader written for that bank's exact file layout, and none matches this file. Nothing was imported, including the other files, so you can fix this and import everything together.`,
          steps: [],
          actions: [
            {
              kind: "remove-files",
              label: "Remove this file and import the rest",
              fileNames: [row.file_name],
            },
            {
              kind: "link",
              label: "Import them freeform instead",
              to: FREEFORM_IMPORT_ROUTE,
            },
          ],
          agent: {
            prompt: unrecognizedPrompt(row),
            afterwards: REDROP_FILE,
          },
          technical: planTechnical,
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
              label: "Remove this file and import the rest",
              fileNames: [row.file_name],
            },
          ],
          agent: {
            prompt: ambiguousPrompt(row),
            afterwards: RETRY_FROM_SCREEN,
          },
          technical: planTechnical,
        });
        break;
      case "unresolved":
        problems.push(unresolvedProblem(row, planTechnical));
        break;
    }
  }
  return problems;
}

function unresolvedProblem(
  row: Extract<AutoImportPlanFile, { status: "unresolved" }>,
  planTechnical: string,
): ProblemBody {
  const account = row.account ? describeStatementAccount(row.account) : null;
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
    technical: `${row.message}\n${planTechnical}`,
    actions: [
      {
        kind: "remove-files" as const,
        label: "Remove this file and import the rest",
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
          prompt: noPresetPrompt(row),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    case "statement_account_identifier_required":
      return {
        ...base,
        key: `identifier-required:${row.file_name}`,
        verdict: "The app can't tell which of your accounts this belongs to.",
        facts: [
          {
            label: "Set up for these statements",
            value: candidates,
            face: "words",
          },
          readerFact,
        ],
        why: `${candidates} ${row.candidate_preset_names.length === 1 ? "is" : "are"} set up to check the account number printed on the statement, but the reader didn't report one. This needs a small fix to the reader or to the account's setup.`,
        steps: [],
        agent: {
          prompt: identifierRequiredPrompt(row),
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
          {
            label: "Set up for these statements",
            value: candidates,
            face: "words",
          },
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
          prompt: identifierMismatchPrompt(row),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
  }
}

// One card for the account whose import failed.
function refusalProblem(refusal: AccountRefusal): ProblemBody {
  const group = refusal.failed_group;
  const base = {
    key: `${refusal.error}:${group.preset_name}`,
    fileNames: [...group.file_names],
    subject: group.preset_name,
    caption: group.file_names.length === 0 ? null : joinNames(group.file_names),
    facts: [] as Stat[],
    technical: technical(refusal),
    steps: [] as string[],
    actions: [] as ProblemAction[],
  };

  switch (refusal.error) {
    case "balance_mismatch": {
      // The server says when a gap is the likely cause.
      const gap = refusal.suspected_gap;
      return {
        ...base,
        verdict:
          "The transactions don't add up to the closing balance the statement prints.",
        facts: [
          {
            label: "Opening plus every transaction",
            value: formatMoney(refusal.computed_final),
          },
          {
            label: "Closing the statement prints",
            value: formatMoney(refusal.statement_closing),
          },
          { label: "Difference", value: formatMoney(refusal.difference) },
        ],
        why: gap
          ? "This usually means there is a gap: some days between the statements are missing, or a statement is incomplete."
          : "This usually means one row was read wrongly.",
        steps: gap
          ? [
              "Check that the statements you dropped cover the whole period with no days missing, add the missing one, and import again.",
            ]
          : [],
        agent: {
          prompt: balanceMismatchPrompt(refusal),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    }
    case "segment_balance_mismatch": {
      const { from_date: fromDate, to_date: toDate } = refusal;
      return {
        ...base,
        verdict: `The running balance doesn't match the transactions between ${formatDate(fromDate)} and ${formatDate(toDate)}.`,
        facts: [
          {
            label: `Printed on ${formatDate(fromDate)}`,
            value: formatMoney(refusal.from_balance),
          },
          {
            label: `Transactions lead to, on ${formatDate(toDate)}`,
            value: formatMoney(refusal.walked),
          },
          {
            label: `Printed on ${formatDate(toDate)}`,
            value: formatMoney(refusal.printed),
          },
          { label: "Difference", value: formatMoney(refusal.difference) },
        ],
        why: "Almost always a row in between was read wrongly by the reader.",
        agent: {
          prompt: balanceMismatchPrompt(refusal),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    }
    case "statement_boundary_mismatch": {
      const earlier = refusal.earlier_source;
      const later = refusal.later_source;
      if (refusal.reason === "same-statement-twice") {
        return {
          ...base,
          verdict: `${later} looks like the same statement as ${earlier}.`,
          why: "Both cover the same dates and start and end at the same balances, so one of them is a duplicate download.",
          actions: [
            {
              kind: "remove-files",
              label: `Remove ${later} and import again`,
              fileNames: [later],
            },
          ],
          agent: null,
        };
      }
      return {
        ...base,
        verdict: `There is a gap between ${earlier} and ${later}.`,
        facts: [
          {
            label: `${earlier} ends at`,
            value: formatMoney(refusal.earlier_closing),
          },
          {
            label: `${later} begins at`,
            value: formatMoney(refusal.later_opening),
          },
          {
            label: "Activity in neither file",
            value: formatMoney(Math.abs(refusal.difference)),
          },
        ],
        why: "The earlier file ends at a different balance than the later one begins with, so activity between them is missing from both. Usually a statement for the period in between is missing.",
        steps: [
          "Download the statement for the missing period, add it here, and import again.",
          `Or import ${earlier} on its own now and the rest later, in date order.`,
        ],
        actions: [
          {
            kind: "keep-only-files",
            label: `Import ${earlier} on its own`,
            fileNames: [earlier],
          },
        ],
        agent: {
          prompt: boundaryGapPrompt(refusal),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    }
    case "statement_disagreement": {
      const { parts, date, row } = refusal;
      const amount =
        row.deposit > 0
          ? `deposit ${formatMoney(row.deposit)}`
          : `withdrawal ${formatMoney(row.withdrawal)}`;
      return {
        ...base,
        verdict: `${joinNames(parts)} both include ${formatDate(date)} but list it differently.`,
        facts: [
          { label: "Day in both files", value: formatDate(date) },
          ...(row.narration
            ? [
                {
                  label: "First row that differs",
                  value: `${row.narration} (${amount})`,
                },
              ]
            : []),
        ],
        why: "This happens when two downloads overlap and one of them was taken before the bank finalised that day.",
        steps: [
          "Download the statements again so their dates don't overlap, or keep only the one you trust for that day, then import again.",
        ],
        actions: parts.map((part) => ({
          kind: "remove-files" as const,
          label: `Remove ${part}`,
          fileNames: [part],
        })),
        agent: {
          prompt: disagreementPrompt(refusal),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    }
    case "statement_part_unjoinable": {
      const { part } = refusal;
      return {
        ...base,
        verdict: `${part} prints no balances, so it can't be placed next to the other files.`,
        why: "Without an opening, closing, or running balance the app can't tell where this file fits in the sequence. It can still be imported on its own.",
        steps: [`Import ${part} by itself, then the other files afterwards.`],
        actions: [
          {
            kind: "keep-only-files",
            label: `Import ${part} on its own`,
            fileNames: [part],
          },
        ],
        agent: null,
      };
    }
    case "statement_part_invalid": {
      const { part, detail } = refusal;
      return {
        ...base,
        verdict: `${part} contradicts itself.`,
        facts: [{ label: "Detail", value: detail, face: "words" }],
        why: "Its own opening or closing balance doesn't match its rows. Either the bank's export is broken or the reader misread it.",
        agent: {
          prompt: partInvalidPrompt(refusal),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    }
    case "reconciliation_match_failed":
      return {
        ...base,
        verdict: "The statement doesn't line up with your books.",
        facts: [
          {
            label: "Books last confirmed on",
            value: formatDate(refusal.checkpoint_date),
          },
          {
            label: "Confirmed balance",
            value: formatMoney(refusal.checkpoint_balance),
          },
        ],
        why: "The statement has rows on that day, but none of them shows the confirmed balance, so the app can't tell which transactions are new. Either your books and the bank have drifted apart, or the statement is missing a row on that day.",
        agent: {
          prompt: reconciliationPrompt(refusal),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    case "opening_balance_unavailable":
      return {
        ...base,
        verdict: "The app needs a starting balance for this account.",
        why: "This statement doesn't print running balances or an opening balance, and your books don't have a confirmed balance for this account yet. This only happens the first time an account is imported.",
        agent: {
          prompt: openingBalancePrompt(refusal),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    case "closing_balance_unavailable":
      return {
        ...base,
        verdict: "The app needs the closing balance for this card.",
        why: "The reader didn't find a total amount owed on this card statement, so the app can't check the import against the bank. Usually the statement does print one and the reader missed it.",
        agent: {
          prompt: closingBalancePrompt(refusal),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    case "assertion_conflict":
      return {
        ...base,
        verdict:
          "Your books already have a different confirmed balance for that day.",
        facts: [{ label: "Day", value: formatDate(refusal.date) }],
        why: "The statement's closing balance for that day doesn't match the balance already recorded as confirmed in your books.",
        agent: {
          prompt: genericFailurePrompt(refusal),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
    case "ambiguous_duplicate":
    case "abacus_json_parse_failed":
    case "categorization_config_error":
      return {
        ...base,
        verdict: "The import stopped with an unexpected error.",
        why: refusal.message,
        agent: {
          prompt: genericFailurePrompt(refusal),
          afterwards: RETRY_FROM_SCREEN,
        },
      };
  }
}

export function describeProblems(failure: ImportFailure): Problem[] {
  const tone = problemTone(failure);
  return problemBodies(failure).map((body) => ({ ...body, tone }));
}

function problemBodies(failure: ImportFailure): ProblemBody[] {
  switch (failure.kind) {
    case "files-unresolved":
      return planProblems(failure);
    case "account-refused":
      return [refusalProblem(failure.refusal)];
    case "forbidden":
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
          technical: null,
        },
      ];
    case "network":
      return [
        {
          key: "upload-failed",
          fileNames: [],
          subject: "Connection",
          caption: null,
          verdict: "The files could not be sent.",
          facts: [],
          why: "The app's server didn't answer. Check that it is running and that you are online, then import again.",
          steps: [],
          actions: [],
          agent: null,
          technical: ["upload_failed", failure.message].join("\n"),
        },
      ];
    case "unexpected":
      return [
        {
          key: "unexpected",
          fileNames: [],
          subject: "The import",
          caption: null,
          verdict: "The import stopped with an unexpected error.",
          facts: [],
          why: "The server's reply isn't one this screen knows how to explain. Its exact words are in the technical details.",
          steps: [],
          actions: [],
          agent: null,
          technical: `HTTP ${failure.status}\n${JSON.stringify(failure.body, null, 2)}`,
        },
      ];
  }
}
