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
    noAccountPrompt,
    partInvalidPrompt,
    reconciliationPrompt,
    unrecognizedPrompt,
} from "./agentPrompts";
import type {AgentPrompt} from "../../agent-prompt-rules";
import type {StatusTone} from "../../components/status-chip";
import {balancesHref} from "../settings/routes";
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
    prompt: AgentPrompt;
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
    // Why, at more length, behind the info button beside the title: for a
    // problem whose title and buttons say enough on their own.
    about?: string;
    // `about` in a few words, over a file's setup button.
    gist?: string;
    // The numbers and names behind it, behind the info button.
    facts: Stat[];
    actions: ProblemAction[];
    agent: ProblemPrompt | null;
    // The server's own words, behind the info button.
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
// A file still to set up stays in the list, and is read again from there.
const CHECK_AGAIN = "When your agent is done, press Try again beside the file.";

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

// One step per file the plan could not place yet. Nothing was imported.
function planProblems(
    failure: Extract<ImportFailure, { kind: "files-unresolved" }>,
): ProblemBody[] {
    const planTechnical = [
        "auto_import_files_unresolved",
        failure.message,
        failure.hint,
    ].join("\n");
    return failure.files.flatMap((row) => {
        const step = setupStep(row);
        if (step === null) return [];
        const technical = [step.technical, planTechnical].filter(Boolean);
        return [{...step, technical: technical.join("\n")}];
    });
}

/**
  * What a dropped file needs before it imports, as the file's row offers it:
  * a format or an account to set up. Null for a file that is ready. These are
  * the ordinary first steps with a new bank, so they read as the next thing
  * to do, never as something gone wrong.
  */
export function describeFileSetup(row: AutoImportPlanFile): Problem | null {
    const step = setupStep(row);
    return step === null ? null : {...step, tone: "attention"};
}

function setupStep(row: AutoImportPlanFile): ProblemBody | null {
    switch (row.status) {
        case "resolved":
            return null;
        case "unrecognized": {
            const tried = row.candidate_parser_paths;
            return {
                key: `unrecognized:${row.file_name}`,
                gist: "This is a new statement format.",
                fileNames: [row.file_name],
                subject: row.file_name,
                title: "New statement format",
                fix: null,
                context: null,
                about:
                    "dbu6 reads each bank's statements with a format set up for that bank, and this one doesn't have one yet. Your coding agent can set it up in a minute. From then on, statements like this import by themselves. If you'd rather not, import the rows freeform instead.",
                facts: [
                    tried.length === 0
                        ? {
                                label: "Formats tried",
                                value: "none for this file type yet",
                                face: "words",
                            }
                        : {
                                label: "Formats tried",
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
                    afterwards: CHECK_AGAIN,
                    goal: "Set up this format",
                },
                technical: null,
            };
        }
        case "ambiguous":
            return {
                key: `ambiguous:${row.file_name}`,
                gist: "Two saved formats both read this file.",
                fileNames: [row.file_name],
                subject: row.file_name,
                title: "Two saved formats read this file",
                fix: null,
                context: null,
                about:
                    "More than one saved format reads this file, so dbu6 asks before choosing. Your coding agent can tell them apart, so exactly one reads it.",
                facts: [
                    {
                        label: "Formats",
                        value: row.matching_parser_paths.map(parserLabel).join(", "),
                    },
                ],
                actions: [],
                agent: {
                    prompt: ambiguousPrompt(row),
                    afterwards: CHECK_AGAIN,
                    goal: "Settle on one format",
                },
                technical: null,
            };
        case "unresolved":
            return unresolvedStep(row);
    }
}

function unresolvedStep(
    row: Extract<AutoImportPlanFile, { status: "unresolved" }>,
): ProblemBody {
    const parserFact: Stat = {
        label: "Format",
        value: parserLabel(row.parser_path),
    };
    const candidates = joinNames(row.candidate_account_names);
    const setUpFact: Stat = {
        label: "Accounts set up",
        value: candidates,
        face: "words",
    };
    const one = row.candidate_account_names.length === 1;
    const base = {
        fileNames: [row.file_name],
        subject: row.institution_name ?? row.institution ?? row.file_name,
        technical: row.message,
        actions: [],
        fix: null,
        context: null,
    };
    switch (row.reason) {
        case "no_institution_for_parser":
        case "institution_has_no_accounts":
            return {
                ...base,
                key: `no-account:${row.file_name}`,
                gist: "It's not clear which account in your books these go to.",
                title: "New account",
                about:
                    "dbu6 recognized the bank and the format of this statement, but doesn't yet know which account in your books it belongs to. Your coding agent can link it to the right account. This is a one-time setup for each account.",
                facts: [parserFact],
                agent: {
                    prompt: noAccountPrompt(row),
                    afterwards: CHECK_AGAIN,
                    goal: "Add this account",
                },
            };
        case "statement_account_identifier_required":
            return {
                ...base,
                key: `identifier-required:${row.file_name}`,
                gist: "Needs its account number to find the account.",
                title: "Account number to read",
                about: `${candidates} ${one ? "is" : "are"} matched by the account number printed on the statement, and this format doesn't read it yet. Your coding agent can add that.`,
                facts: [setUpFact, parserFact],
                agent: {
                    prompt: identifierRequiredPrompt(row),
                    afterwards: CHECK_AGAIN,
                    goal: "Match the account number",
                },
            };
        case "statement_account_identifier_mismatch":
            return {
                ...base,
                key: `identifier-mismatch:${row.file_name}`,
                gist: "An account you haven't added yet.",
                title: "New account",
                about: `${candidates} ${one ? "has" : "have"} a different account number, so this is an account you haven't added yet. If the file isn't yours to import, remove it.`,
                facts: [setUpFact],
                agent: {
                    prompt: identifierMismatchPrompt(row),
                    afterwards: CHECK_AGAIN,
                    goal: "Add this account",
                },
            };
    }
}

// The one problem for the account whose import failed.
function refusalProblem(
    refusal: AccountRefusal,
): ProblemBody {
    const group = refusal.failed_group;
    const base = {
        key: `${refusal.error}:${group.account_id}`,
        fileNames: [...group.file_names],
        subject: group.account_name,
        facts: [] as Stat[],
        technical: technical(refusal),
        actions: [] as ProblemAction[],
    };

    switch (refusal.error) {
        case "import_account_not_found":
            return {
                ...base,
                title: "Account not in your books",
                fix: `Add the account back, or import ${group.account_name} into an account you have.`,
                context: `The account in your books that ${group.account_name} imports into has been deleted, so its transactions would belong to no account. The following AI prompt can set it up.`,
                actions: [{kind: "link", label: "Open accounts", to: "/accounts"}],
                agent: {
                    prompt: missingAccountPrompt(refusal),
                    afterwards: RETRY_FROM_SCREEN,
                    goal: "Add this account",
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
                fix: `Record ${group.base_account}'s opening balance, then import again.`,
                context:
                    "The statement has no opening or running balances, and your books have no confirmed balance for this account yet. This only happens on an account's first import. Its opening balance is what it held or owed the day before the statement's first transaction.",
                actions: [
                    {
                        kind: "link",
                        label: "Record the opening balance",
                        to: balancesHref(group.base_account),
                    },
                ],
                agent: null,
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
