import type {
    AutoImportPlanFile,
    StatementImportError,
    StatementImportErrorCode,
} from "../../../shared/index";
import {
    ambiguousPrompt,
    balanceMismatchPrompt,
    boundaryGapPrompt,
    closingBalancePrompt,
    disagreementPrompt,
    genericFailurePrompt,
    identifierMismatchPrompt,
    identifierRequiredPrompt,
    missingAccountPrompt,
    noPresetPrompt,
    openingBalancePrompt,
    partInvalidPrompt,
    reconciliationPrompt,
    unrecognizedPrompt,
} from "./agentPrompts";
import type {StatusTone} from "../../components/status-chip";
import type {Stat} from "./describeGroup";
import type {AccountRefusal, ImportFailure} from "./outcome";
import {
    describeStatementAccount,
    formatDate,
    formatMoney,
    joinNames,
    parserLabel,
} from "../../format";

// Something the screen can do by itself, offered as a button. Removing a
// file is the file row's ×, so an action only removes a file the problem
// doesn't sit under.
export type ProblemAction =
    | { kind: "remove-files"; label: string; fileNames: string[] }
    | { kind: "keep-only-files"; label: string; fileNames: string[] }
    | { kind: "link"; label: string; to: string };

// What a problem hands to the user's coding agent: the prompt, and what the
// user does once the agent reports back.
export interface ProblemPrompt {
    prompt: string;
    afterwards: string;
    // What the agent gets done, in the button's words: "Fix the parser".
    goal: string;
}

// How serious a problem is. Destructive ("problem") when the numbers don't
// add up; attention when something needs setting up.
export type ProblemTone = Extract<StatusTone, "problem" | "attention">;

/**
 * One thing that stopped the import. It shows under the last of its files
 * in the list, or on its own when it concerns no file, and reads top to
 * bottom: what's wrong, what to do, and why, leading into the prompt.
 */
export interface Problem {
    key: string;
    tone: ProblemTone;
    // The files it concerns, in the batch's terms.
    fileNames: string[];
    // Whose problem: the account, the bank, or failing both, the file. It
    // heads a problem that concerns no file, and names the account when the
    // problem spans several files.
    subject: string;
    // What's wrong, in a few words: the headline.
    title: string;
    // What to do about it, in the imperative. Null when there is nothing the
    // user can do.
    fix: string | null;
    // Why, in a sentence or three. With an agent, its last sentence leads into
    // the prompt. It must read whole without the facts.
    context: string | null;
    // The numbers and names behind it, folded under Details.
    facts: Stat[];
    actions: ProblemAction[];
    agent: ProblemPrompt | null;
    // The server's own words, folded under Details.
    technical: string | null;
}

// How serious each statement import error is. Destructive when the numbers
// don't add up; attention when something needs setting up. The codes without
// a problem of their own take the unexpected-error one, destructive too.
const STATEMENT_ERROR_TONE: Record<StatementImportErrorCode, ProblemTone> = {
    import_account_not_found: "attention",
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

const RETRY_FROM_SCREEN = "When the agent is done, import again.";
const REDROP_FILE =
    "When the agent says the parser is done, drop this file again and import it.";

/**
 * Where each problem shows: under the last of its files still in the batch,
 * so it follows everything it concerns, or on its own when none of its files
 * is in the list.
 */
export function placeProblems(
    problems: readonly Problem[],
    batch: readonly string[],
): { under: Map<string, Problem[]>; apart: Problem[] } {
    const under = new Map<string, Problem[]>();
    const apart: Problem[] = [];
    for (const problem of problems) {
        const host = [...batch]
            .reverse()
            .find((name) => problem.fileNames.includes(name));
        if (host === undefined) {
            apart.push(problem);
        } else {
            under.set(host, [...(under.get(host) ?? []), problem]);
        }
    }
    return {under, apart};
}

// A problem before the tone its error gives every problem.
type ProblemBody = Omit<Problem, "tone">;

// The server's own words: the code, its message, and any detail or hint.
function technical(error: StatementImportError): string {
    const detail = "detail" in error ? error.detail : undefined;
    const hint = "hint" in error ? error.hint : undefined;
    return [error.error, error.message, detail, hint]
        .filter((part): part is string => part !== undefined && part !== "")
        .join("\n");
}

// One problem per file the plan could not place. Nothing was imported.
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
                    title: "Could not recognize this statement format",
                    fix: "We don't have a parser for this format. Automatically create one below.",
                    context:
                        "Unable to read transactions from this file, since its format was not recognized by any existing parser. Please create a parser for this file format and upload again.",
                    facts: [
                        tried.length === 0
                            ? {
                                label: "Parsers tried",
                                value: "none fit this file type",
                                face: "words",
                            }
                            : {
                                label: "Parsers tried",
                                value: tried.map(parserLabel).join(", "),
                            },
                    ],
                    actions: [
                        {
                            kind: "link",
                            label: "Import freeform instead",
                            to: FREEFORM_IMPORT_ROUTE,
                        },
                    ],
                    agent: {
                        prompt: unrecognizedPrompt(row),
                        afterwards: REDROP_FILE,
                        goal: "Create new parser automatically",
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
                    title: "More than one parser matches this format",
                    fix: "Make only one parser match it.",
                    context:
                        "The app can't tell which parser to trust. The parsers need fixing, not your file. The following AI prompt can tell them apart.",
                    facts: [
                        {
                            label: "Parsers",
                            value: row.matching_parser_paths.map(parserLabel).join(", "),
                        },
                    ],
                    actions: [],
                    agent: {
                        prompt: ambiguousPrompt(row),
                        afterwards: RETRY_FROM_SCREEN,
                        goal: "Tell the parsers apart",
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
    const parserFact: Stat = {
        label: "Parser",
        value: parserLabel(row.parser_path),
    };
    const candidates = joinNames(row.candidate_preset_names);
    const setUpFact: Stat = {
        label: "Set up for these statements",
        value: candidates,
        face: "words",
    };
    const one = row.candidate_preset_names.length === 1;
    const base = {
        fileNames: [row.file_name],
        subject: row.institution ?? row.file_name,
        technical: `${row.message}\n${planTechnical}`,
        actions: [],
    };
    switch (row.reason) {
        case "no_preset_for_parser":
            return {
                ...base,
                key: `no-preset:${row.file_name}`,
                title: "No account set up for this statement",
                fix: "Set up the account for these transactions.",
                context:
                    "All the transactions in your statement were parsed. However, you haven't specified which account these transactions should be entered into. You only need to set this up once per account. It can be set up automatically using the following AI prompt.",
                facts: [parserFact],
                agent: {
                    prompt: noPresetPrompt(row),
                    afterwards: RETRY_FROM_SCREEN,
                    goal: "Set up the account",
                },
            };
        case "statement_account_identifier_required":
            return {
                ...base,
                key: `identifier-required:${row.file_name}`,
                title: "Parser didn't read the account number",
                fix: "Make the parser read the account number.",
                context: `${candidates} ${one ? "is" : "are"} set up to match the account number printed on the statement, so the app needs it to tell which account this is. The following AI prompt can fix the parser.`,
                facts: [setUpFact, parserFact],
                agent: {
                    prompt: identifierRequiredPrompt(row),
                    afterwards: RETRY_FROM_SCREEN,
                    goal: "Fix the parser",
                },
            };
        case "statement_account_identifier_mismatch":
            return {
                ...base,
                key: `identifier-mismatch:${row.file_name}`,
                title: "Statement is for a different account",
                fix: "Set up this account, or remove the file.",
                context: `${candidates} ${one ? "has" : "have"} a different account number, so this is either an account you haven't set up yet or a file dropped here by mistake. A new account can be set up automatically using the following AI prompt.`,
                facts: [setUpFact],
                agent: {
                    prompt: identifierMismatchPrompt(row),
                    afterwards: RETRY_FROM_SCREEN,
                    goal: "Set up this account",
                },
            };
    }
}

// The one problem for the account whose import failed.
function refusalProblem(refusal: AccountRefusal): ProblemBody {
    const group = refusal.failed_group;
    const base = {
        key: `${refusal.error}:${group.preset_name}`,
        fileNames: [...group.file_names],
        subject: group.preset_name,
        facts: [] as Stat[],
        technical: technical(refusal),
        actions: [] as ProblemAction[],
    };

    switch (refusal.error) {
        case "import_account_not_found":
            return {
                ...base,
                title: "Account not in your books",
                fix: `Add ${group.base_account} to your accounts, or set the preset to an account you have.`,
                context: `${group.preset_name} imports into ${group.base_account}, which isn't in your accounts, so its transactions would belong to no account. The following AI prompt can set it up.`,
                actions: [{kind: "link", label: "Open accounts", to: "/accounts"}],
                agent: {
                    prompt: missingAccountPrompt(refusal),
                    afterwards: RETRY_FROM_SCREEN,
                    goal: "Set up the account",
                },
            };
        case "balance_mismatch": {
            // The server says when a gap is the likely cause.
            const gap = refusal.suspected_gap;
            const off = `The transactions end ${formatMoney(Math.abs(refusal.difference))} away from the closing balance the statement prints.`;
            return {
                ...base,
                title: "Transactions don't add up to the closing balance",
                fix: gap ? "Add the missing statement." : "Find the misread row.",
                context: gap
                    ? `${off} Usually some days between the statements are missing, or a statement is incomplete. Add it and import again, or find what's missing using the following AI prompt.`
                    : `${off} This usually means the parser misread one row. The following AI prompt can find it.`,
                facts: [
                    {
                        label: "Opening plus every transaction",
                        value: formatMoney(refusal.computed_final),
                    },
                    {
                        label: "Closing the statement prints",
                        value: formatMoney(refusal.statement_closing),
                    },
                    {label: "Difference", value: formatMoney(refusal.difference)},
                ],
                agent: {
                    prompt: balanceMismatchPrompt(refusal),
                    afterwards: RETRY_FROM_SCREEN,
                    goal: gap ? "Find what's missing" : "Find the misread row",
                },
            };
        }
        case "segment_balance_mismatch": {
            const {from_date: fromDate, to_date: toDate} = refusal;
            return {
                ...base,
                title: `Balance breaks between ${formatDate(fromDate)} and ${formatDate(toDate)}`,
                fix: "Find the misread row.",
                context:
                    "The running balance the statement prints doesn't follow from the transactions between those dates. Almost always, the parser misread a row in between. The following AI prompt can find it.",
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
                    {label: "Difference", value: formatMoney(refusal.difference)},
                ],
                agent: {
                    prompt: balanceMismatchPrompt(refusal),
                    afterwards: RETRY_FROM_SCREEN,
                    goal: "Find the misread row",
                },
            };
        }
        case "statement_boundary_mismatch": {
            const earlier = refusal.earlier_source;
            const later = refusal.later_source;
            if (refusal.reason === "same-statement-twice") {
                return {
                    ...base,
                    title: "Same statement uploaded twice",
                    fix: "Remove the duplicate.",
                    context: `${later} covers the same dates and balances as ${earlier}, so one of them is a duplicate download.`,
                    actions: [
                        {
                            kind: "remove-files",
                            label: `Remove ${later}`,
                            fileNames: [later],
                        },
                    ],
                    agent: null,
                };
            }
            return {
                ...base,
                title: `Statements missing between ${earlier} and ${later}`,
                fix: "Add the statement for the missing period.",
                context: `${earlier} ends at a different balance than ${later} begins with, so some activity in between is in neither file. Add the missing statement and import again, or import ${earlier} on its own for now. The following AI prompt can pin down the missing period.`,
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
                actions: [
                    {
                        kind: "keep-only-files",
                        label: `Keep only ${earlier}`,
                        fileNames: [earlier],
                    },
                ],
                agent: {
                    prompt: boundaryGapPrompt(refusal),
                    afterwards: RETRY_FROM_SCREEN,
                    goal: "Find the missing period",
                },
            };
        }
        case "statement_disagreement": {
            const {parts, date, row} = refusal;
            const amount =
                row.deposit > 0
                    ? `deposit ${formatMoney(row.deposit)}`
                    : `withdrawal ${formatMoney(row.withdrawal)}`;
            return {
                ...base,
                title: `Two files disagree about ${formatDate(date)}`,
                fix: "Keep the file you trust for that day.",
                context: `${joinNames(parts)} both include ${formatDate(date)} but list it differently. Usually the downloads overlap, and one was taken before the bank finalised that day. Remove the one you trust less, or work out which is right using the following AI prompt.`,
                facts: row.narration
                    ? [
                        {
                            label: "First row that differs",
                            value: `${row.narration} (${amount})`,
                        },
                    ]
                    : [],
                actions: parts.map((part) => ({
                    kind: "remove-files" as const,
                    label: `Remove ${part}`,
                    fileNames: [part],
                })),
                agent: {
                    prompt: disagreementPrompt(refusal),
                    afterwards: RETRY_FROM_SCREEN,
                    goal: "Work out which file is right",
                },
            };
        }
        case "statement_part_unjoinable": {
            const {part} = refusal;
            return {
                ...base,
                title: `${part} has no balances`,
                fix: "Import it on its own.",
                context:
                    "Without an opening, closing or running balance, the app can't tell where it fits among the other files. On its own, it imports fine.",
                actions: [
                    {
                        kind: "keep-only-files",
                        label: `Keep only ${part}`,
                        fileNames: [part],
                    },
                ],
                agent: null,
            };
        }
        case "statement_part_invalid": {
            const {part, detail} = refusal;
            return {
                ...base,
                title: `${part} contradicts itself`,
                fix: "Check whether the file or the parser is wrong.",
                context:
                    "Its own opening or closing balance doesn't match its rows: either the bank's export is broken, or the parser misread it. The following AI prompt can find out which.",
                facts: [{label: "Detail", value: detail, face: "words"}],
                agent: {
                    prompt: partInvalidPrompt(refusal),
                    afterwards: RETRY_FROM_SCREEN,
                    goal: "Check the file and the parser",
                },
            };
        }
        case "reconciliation_match_failed":
            return {
                ...base,
                title: "Statement doesn't match your books",
                fix: "Line it up with your last confirmed balance.",
                context: `Your books were last confirmed at ${formatMoney(refusal.checkpoint_balance)} on ${formatDate(refusal.checkpoint_date)}, but none of the statement's rows that day shows that balance, so the app can't tell which transactions are new. The following AI prompt can find where they drifted apart.`,
                agent: {
                    prompt: reconciliationPrompt(refusal),
                    afterwards: RETRY_FROM_SCREEN,
                    goal: "Compare with your books",
                },
            };
        case "opening_balance_unavailable":
            return {
                ...base,
                title: "Starting balance missing",
                fix: "Set this account's starting balance.",
                context:
                    "The statement has no opening or running balances, and your books have no confirmed balance for this account yet. This only happens on an account's first import. It can be set using the following AI prompt.",
                agent: {
                    prompt: openingBalancePrompt(refusal),
                    afterwards: RETRY_FROM_SCREEN,
                    goal: "Set the starting balance",
                },
            };
        case "closing_balance_unavailable":
            return {
                ...base,
                title: "Card's amount owed not found",
                fix: "Make the parser find the amount owed.",
                context:
                    "Without the total amount owed, the import can't be checked against the bank. The statement usually prints one, and the parser missed it. The following AI prompt can fix the parser.",
                agent: {
                    prompt: closingBalancePrompt(refusal),
                    afterwards: RETRY_FROM_SCREEN,
                    goal: "Fix the parser",
                },
            };
        case "assertion_conflict":
            return {
                ...base,
                title: `Confirmed balance for ${formatDate(refusal.date)} differs`,
                fix: "Find out which balance is right.",
                context:
                    "The statement's closing balance for that day doesn't match the one already confirmed in your books. The following AI prompt can find out which is right.",
                agent: {
                    prompt: genericFailurePrompt(refusal),
                    afterwards: RETRY_FROM_SCREEN,
                    goal: "Find which balance is right",
                },
            };
        case "ambiguous_duplicate":
        case "abacus_json_parse_failed":
        case "categorization_config_error":
            return {
                ...base,
                title: "Import stopped with an unexpected error",
                fix: "Investigate the error.",
                context: `${refusal.message} The following AI prompt can investigate it.`,
                agent: {
                    prompt: genericFailurePrompt(refusal),
                    afterwards: RETRY_FROM_SCREEN,
                    goal: "Investigate the error",
                },
            };
    }
}

export function describeProblems(failure: ImportFailure): Problem[] {
    const tone = problemTone(failure);
    return problemBodies(failure).map((body) => ({...body, tone}));
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
                    title: "No permission to import",
                    fix: "Sign in with an account that manages these books, then try again.",
                    context: null,
                    facts: [],
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
                    title: "Files couldn't be sent",
                    fix: "Check that the app's server is running and you are online, then import again.",
                    context: "The app's server didn't answer.",
                    facts: [],
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
                    title: "Unexpected reply from the server",
                    fix: null,
                    context:
                        "The server's reply isn't one this screen knows how to explain. Its exact words are under Details.",
                    facts: [],
                    actions: [],
                    agent: null,
                    technical: `HTTP ${failure.status}\n${JSON.stringify(failure.body, null, 2)}`,
                },
            ];
    }
}
