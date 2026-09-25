import { extname } from "node:path";
import { Temporal } from "@sapporta/shared/temporal";
import {
  accountKindOf,
  type AccountKind,
  type AddAccountAdded,
  type AddAccountCandidate,
  type AddAccountFields,
  type AddAccountFile,
  type AddAccountRefusal,
  type CategorizerStatus,
  type ImportAccount,
  type ImportInstitution,
  type StatementAccount,
  type StatementAccountChange,
  type StatementAccountRefusal,
  type StatementOpening,
} from "../../shared/index.js";
import {
  findOpeningBalancesAccount,
  loadAccountChart,
  loadLedgerAccounts,
} from "../modules/accounts/index.js";
import type { LoadCategorizer } from "../modules/categorization/index.js";
import { categorizationLlm } from "../modules/coding-agent/index.js";
import { loadDraftStatus } from "../modules/drafts/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
import {
  countOwnEntriesByAccount,
  loadOpeningEntries,
  lookupLastReconciled,
} from "../modules/journals/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import {
  assembleStatements,
  type AbacusStatement,
} from "../modules/statement/index.js";
import {
  changesListingParsers,
  planAutoImport,
  recognizeStatementFile,
  savedCustomStatementParserNames,
  type AutoImportGroup,
  type FileRecognition,
} from "../modules/statement-sources/index.js";
import { parseAccount, sameAmount } from "../modules/values/index.js";
import {
  changeImportPresets,
  changeStatementAccount,
  loadStatementAccounts,
  newStatementAccountMappingFiles,
} from "./import-presets.js";
import {
  loadOpeningBalances,
  recordOpeningBalance,
} from "./opening-balances.js";
import {
  AccountNotFoundError,
  checkStatement,
  importPlannedGroups,
  isImportRefusal,
  type ImportRefusal,
  type StagedStatement,
} from "./statement-import/index.js";

/*
 * Adding a bank or card from its statements (/add). Nothing here is special
 * to onboarding: the files are read as /import reads them, and added with
 * /import's own import at the end.
 *
 *   readStatements                    /import's recognition and plan, no writes
 *     per file: savedCustomStatementParserNames, recognizeStatementFile
 *     -> groupDrop                       pure: one group per account
 *     -> checkStatements                 opening, rows, the opening to record,
 *                                        the import's refusal
 *
 *   addAccount                        the same reading; then in order, each
 *                                     step refusing before the next writes:
 *     1  checkBeforeWriting              checkStatements, and the config the
 *                                        writes need
 *     2  new:   changeStatementAccount   the account and its preset, with the
 *                                        parsers and number, one transaction
 *        empty: changeImportPresets      the parsers and number it lacks
 *     3  importAdded:
 *          recordOpeningBalance          unless the account has one that agrees
 *          importPlannedGroups           the /import tail, categorization too
 *
 * The writes are separate transactions: the presets' writer checks parsers
 * on disk before its own, which one SQLite transaction can't wait for.
 * Everything that doesn't depend on timing is checked before the first, so
 * only the import's own tail (duplicates, an agent failing) or a request
 * racing this one leaves an account set up with no transactions. Its
 * statements dropped again then read as `empty`, and adding finishes it.
 */

/** A dropped statement, staged, and its path relative to the project. */
export interface DroppedStatement extends StagedStatement {
  projectPath: string;
}

/**
 * An account the drop belongs to, as the reply gives it, with the import's
 * refusal as the error itself: the route words it as /import does.
 */
export type CandidateReading = Omit<AddAccountCandidate, "refusal"> & {
  refusal: ImportRefusal | null;
};

/** The read's reply, but for the route's wording of the refusals. */
export interface DropReading {
  // A read file's `saved_path` is null: the route sets it when it keeps
  // the drop.
  files: AddAccountFile[];
  accounts: CandidateReading[];
  categorizer: CategorizerStatus;
}

// A file one parser read, under the name it was dropped as.
type RecognizedStatement = AutoImportGroup["statements"][number];

/** One account's files in a drop. */
export interface DropGroup {
  // What the reply calls it; output only.
  key: string;
  // The preset account the files are, or null for an account not set up.
  accountId: number | null;
  // In date order.
  statements: RecognizedStatement[];
}

/**
 * The read files of a drop, by the account they belong to. Pure. A file is
 * the preset account `planAutoImport` places it with, or the one set up
 * with the number it prints when no bank lists its parser
 * (`numberedAccount`); else it is a new account's, by `newAccountKey`.
 * Files no parser reads, or several do, belong to none.
 */
export function groupDrop(
  recognitions: readonly FileRecognition[],
  presets: readonly ImportInstitution[],
): DropGroup[] {
  const planned = planAutoImport(recognitions, presets).files;
  const groups = new Map<string, DropGroup>();
  recognitions.forEach((recognition, index) => {
    if (recognition.outcome !== "recognized") return;
    const { file, parserName, statement } = recognition;
    const placed = planned[index];
    const accountId =
      placed.status === "resolved"
        ? placed.accountId
        : placed.status === "unresolved" &&
            placed.reason === "no_institution_for_parser"
          ? numberedAccount(presets, statement.account)
          : null;
    const key =
      accountId === null
        ? newAccountKey(parserName, statement.account)
        : `account:${accountId}`;
    const group = groups.get(key) ?? { key, accountId, statements: [] };
    group.statements.push({ file, parserName, statement });
    groups.set(key, group);
  });
  for (const group of groups.values()) {
    group.statements.sort((a, b) => firstDate(a).localeCompare(firstDate(b)));
  }
  return [...groups.values()];
}

/*
 * The files of one account no preset takes. A printed number names an
 * account whichever parser read it (a bank's PDF and its spreadsheet export
 * are one account), and bank and card numbers are apart. A statement that
 * prints none is taken as the one account its parser reads, which is how
 * the presets place it once added: an institution's one unnumbered account
 * takes every statement.
 */
function newAccountKey(
  parserName: string,
  printed: StatementAccount | null,
): string {
  return printed === null
    ? `new:parser:${parserName}`
    : `new:${printed.kind}:${printed.identifier}`;
}

/*
 * A bank or card set up with its number and no parser (by an agent, through
 * /api/setup/statement-accounts, or by the old Banks & cards step): the
 * statement whose parser no institution lists is its, when it prints that
 * number and no other account has it. Adding it then lists the parser.
 */
function numberedAccount(
  presets: readonly ImportInstitution[],
  printed: StatementAccount | null,
): number | null {
  if (printed === null) return null;
  const numbered = presets.flatMap((institution) =>
    institution.accounts.filter((account) =>
      account.account_identifiers.includes(printed.identifier),
    ),
  );
  return numbered.length === 1 ? numbered[0].account_id : null;
}

function firstDate(statement: RecognizedStatement): string {
  // No rows sorts last.
  return statement.statement.transactions[0]?.date ?? "~";
}

// One group, read: what the reply says of it, and what adding needs.
interface Share {
  candidate: CandidateReading;
  statements: RecognizedStatement[];
  // The institution that lists one of its parsers, if any: the account's
  // own for `empty` and `in_books`.
  lister: ImportInstitution | null;
  // The preset account, for `empty` and `in_books`.
  preset: ImportAccount | null;
}

/** What the dropped files are, as /import would take them. Writes nothing. */
export async function readStatements(
  ledger: Ledger,
  files: readonly DroppedStatement[],
): Promise<DropReading> {
  const { files: read, shares } = await readDrop(ledger, files);
  return {
    files: read,
    accounts: shares.map((share) => share.candidate),
    categorizer: await categorizerStatus(),
  };
}

async function readDrop(
  ledger: Ledger,
  files: readonly DroppedStatement[],
): Promise<{ files: AddAccountFile[]; shares: Share[] }> {
  const recognitions: FileRecognition[] = [];
  for (const file of files) {
    const parsers = await savedCustomStatementParserNames(extname(file.path));
    recognitions.push({
      ...(await recognizeStatementFile(parsers, file.path)),
      file: file.name,
    });
  }
  // Read after the parsers ran: they take a while.
  const presets = loadImportPresets(ledger.db, ledger.auth);
  const groups = groupDrop(recognitions, presets);

  const rows = recognitions.map((recognition, index): AddAccountFile => {
    const file = files[index];
    switch (recognition.outcome) {
      case "unrecognized":
        return {
          status: "unrecognized",
          file_name: file.name,
          saved_path: file.projectPath,
          candidate_parser_paths: recognition.candidateParserNames,
        };
      case "ambiguous":
        return {
          status: "ambiguous",
          file_name: file.name,
          saved_path: file.projectPath,
          matching_parser_paths: recognition.matchingParserNames,
        };
      case "recognized": {
        const { statement } = recognition;
        const group = groups.find((one) =>
          one.statements.some((read) => read.statement === statement),
        )!;
        return {
          status: "read",
          file_name: file.name,
          account_key: group.key,
          parser: recognition.parserName,
          period: periodOf([statement]),
          transactions: statement.transactions.length,
          saved_path: null,
        };
      }
    }
  });

  const activity = loadStatementActivity(ledger);
  const ledgerNames = new Map(
    loadLedgerAccounts(ledger.sqlite, ledger.auth).map((one) => [
      one.id,
      one.name,
    ]),
  );
  const shares = groups.map(({ key, accountId, statements }): Share => {
    const common = {
      key,
      parsers: [...new Set(statements.map((one) => one.parserName))],
      file_names: statements.map((one) => one.file),
      identifier: printedAccount(statements)?.identifier ?? null,
      period: periodOf(statements.map((one) => one.statement)),
    };
    const home = accountId === null ? null : presetHome(presets, accountId);

    if (home === null) {
      const lister =
        presets.find((one) =>
          common.parsers.some((parser) => one.parsers.includes(parser)),
        ) ?? null;
      const printedName = statements.find((one) => one.statement.institution)
        ?.statement.institution;
      const kind = printedAccount(statements)?.kind ?? null;
      const checked = checkStatements(
        ledger,
        // A statement that prints no number doesn't say bank or card, so it
        // is checked here as a bank's; a refusal only a card gets (no
        // closing) shows at `add`, which checks it as the kind the user says.
        { id: null, name: "New account", kind: kind ?? "bank" },
        statements,
        null,
      );
      return {
        candidate: {
          ...common,
          status: "new",
          account: null,
          institution:
            lister?.name ??
            knownSpelling(presets, tidyBankName(printedName ?? "")),
          institution_listed: lister !== null,
          kind,
          ...reported(checked),
          refusal: checked.importRefusal,
        },
        statements,
        lister,
        preset: null,
      };
    }

    const { institution, account } = home;
    const name = ledgerNames.get(account.account_id);
    const kind = accountKindOf(account.is_credit_card);
    const checked = checkStatements(
      ledger,
      { id: account.account_id, name: name ?? account.name, kind },
      statements,
      null,
    );
    return {
      candidate: {
        ...common,
        status: hasTransactions(activity(account.account_id))
          ? "in_books"
          : "empty",
        account: { id: account.account_id, name: name ?? account.name },
        institution: institution.name,
        institution_listed: true,
        kind,
        ...reported(checked),
        refusal:
          name === undefined
            ? new AccountNotFoundError(account.name, account.account_id)
            : checked.importRefusal,
      },
      statements,
      lister: institution,
      preset: account,
    };
  });

  // Earliest first; those with no rows last.
  shares.sort(
    (a, b) =>
      (a.candidate.period?.first_date ?? "~").localeCompare(
        b.candidate.period?.first_date ?? "~",
      ) || a.candidate.key.localeCompare(b.candidate.key),
  );
  return { files: rows, shares };
}

// What the reply says of a check but the import's refusal: the opening, the
// rows, whether adding needs a typed opening, and the opening's refusal.
function reported(
  checked: StatementsCheck,
): Pick<
  AddAccountCandidate,
  "opening" | "transactions" | "needs_opening" | "opening_refusal"
> {
  const { decision } = checked;
  const refused = decision !== null && !decision.ok ? decision : null;
  return {
    opening: checked.opening,
    transactions: checked.transactions,
    needs_opening: refused?.code === "opening_balance_needed",
    opening_refusal:
      refused === null || refused.code === "opening_balance_needed"
        ? null
        : { code: refused.code, error: refused.error },
  };
}

function printedAccount(
  statements: readonly RecognizedStatement[],
): StatementAccount | null {
  return (
    statements.find((one) => one.statement.account)?.statement.account ?? null
  );
}

// A preset institution's own spelling of a name, when one has it.
function knownSpelling(
  presets: readonly ImportInstitution[],
  name: string,
): string {
  return (
    presets.find((one) => one.name.toLowerCase() === name.toLowerCase())
      ?.name ?? name
  );
}

function periodOf(
  statements: readonly AbacusStatement[],
): AddAccountCandidate["period"] {
  const dates = statements.flatMap((one) =>
    one.transactions.map((row) => row.date),
  );
  if (dates.length === 0) return null;
  return {
    first_date: dates.reduce((a, b) => (a < b ? a : b)),
    last_date: dates.reduce((a, b) => (a > b ? a : b)),
  };
}

/** What an account's statements hold, and what adding them would refuse. */
interface StatementsCheck {
  // The assembled statement's, or the earliest part's when the parts don't
  // assemble; null with no rows.
  opening: StatementOpening | null;
  transactions: number;
  // `openingToRecord`'s; null with no rows.
  decision: OpeningDecision | null;
  // The import's own refusal (`checkStatement`), or null.
  importRefusal: ImportRefusal | null;
}

/*
 * The one check of an account's statements, for the read and the add: the
 * account in the books (`id`) or one to be made (`id` null, named `name`).
 * The statements are assembled; the opening they give decides the opening
 * to record (`openingToRecord`, with `typedAmount`); and the import's own
 * checks (`checkStatement`: gaps with their amount, parts that can't be
 * placed, balances that don't add up) walk them from that opening, else
 * from the account's last confirmed balance. Statements that print no
 * balance, with neither, are the user's to open; they are walked from a
 * stand-in meanwhile, so the rest is still checked.
 */
function checkStatements(
  ledger: Ledger,
  account: { id: number | null; name: string; kind: AccountKind },
  statements: readonly RecognizedStatement[],
  typedAmount: number | null,
): StatementsCheck {
  const parts = statements.map((one) => one.statement);
  const names = statements.map((one) => one.file);
  let assembled: AbacusStatement | null = null;
  let importRefusal: ImportRefusal | null = null;
  try {
    assembled = assembleStatements(parts, names);
  } catch (error) {
    if (!isImportRefusal(error)) throw error;
    importRefusal = error;
  }
  const opening = statementOpening(assembled ?? parts[0]);
  const decision =
    opening === null
      ? null
      : openingToRecord(ledger, account.id, opening, typedAmount);

  if (assembled !== null && opening !== null) {
    const confirmed =
      account.id === null
        ? null
        : (lookupLastReconciled(ledger.sqlite, ledger.auth, account.name)
            ?.balance ?? null);
    const toRecord = decision?.ok ? decision.amount : null;
    const standIn = opening.amount === null ? 0 : null;
    try {
      checkStatement(
        parts,
        { baseAccount: parseAccount(account.name), accountKind: account.kind },
        toRecord ?? confirmed ?? standIn,
        names,
      );
    } catch (error) {
      if (!isImportRefusal(error)) throw error;
      importRefusal = error;
    }
  }
  return {
    opening,
    transactions:
      assembled?.transactions.length ??
      parts.reduce((n, one) => n + one.transactions.length, 0),
    decision,
    importRefusal,
  };
}

/**
 * The balance the account held the day before the statement's first row:
 * the opening it prints; else its first printed balance less the rows up to
 * and including that one; else the closing it prints less every row. The
 * amount is null when it prints no balance at all. Several statements are
 * assembled first (`assembleStatements`), so this is the earliest one's.
 */
export function statementOpening(
  statement: AbacusStatement,
): StatementOpening | null {
  const rows = statement.transactions;
  if (rows.length === 0) return null;
  const date = Temporal.PlainDate.from(rows[0].date)
    .subtract({ days: 1 })
    .toString();
  if (statement.opening !== null) return { date, amount: statement.opening };
  const first = rows.findIndex((row) => row.balance !== null);
  const [balance, through] =
    first !== -1
      ? [rows[first].balance!, first + 1]
      : [statement.closing, rows.length];
  if (balance === null) return { date, amount: null };
  const moved = rows
    .slice(0, through)
    .reduce((sum, row) => sum + row.deposit - row.withdrawal, 0);
  // To the paisa: the sum is float arithmetic.
  return { date, amount: Math.round((balance - moved) * 100) / 100 };
}

/*
 * The bank's name as a statement prints it, tidied for the presets:
 * "Ltd", "Ltd." and "Limited" go, and so does trailing punctuation. An
 * all-caps word longer than four letters is title-cased ("STANDARD" is
 * "Standard"); a shorter one is kept as an acronym ("HDFC", "SBI"), except
 * the words a bank's name is made of ("BANK" is "Bank"; "OF" is "of", and
 * "The" when it leads). Words printed in mixed case are kept as printed.
 */
const COMPANY_SUFFIX = /^(ltd|limited)\.?$/i;
const COMMON_WORDS = new Map([
  ["BANK", "Bank"],
  ["CARD", "Card"],
  ["CARDS", "Cards"],
]);
const JOINING_WORDS = new Set(["OF", "AND", "THE", "FOR"]);

export function tidyBankName(printed: string): string {
  const words = printed
    .split(/\s+/)
    .map((word) => word.replace(/[,;:]+$/, ""))
    .filter((word) => word !== "" && !COMPANY_SUFFIX.test(word));
  return words
    .map((word, index) => {
      const letters = word.replace(/[^A-Za-z]/g, "");
      if (letters === "" || letters !== letters.toUpperCase()) return word;
      const common = COMMON_WORDS.get(letters);
      if (common !== undefined) return word.replace(letters, common);
      if (JOINING_WORDS.has(letters)) {
        return index > 0 ? word.toLowerCase() : titleCase(word);
      }
      return letters.length <= 4 ? word : titleCase(word);
    })
    .join(" ")
    .replace(/[\s.,;:\-–—]+$/, "");
}

function titleCase(word: string): string {
  return word.toLowerCase().replace(/[a-z]/, (first) => first.toUpperCase());
}

// Who categorizes an import: the engine the import itself asks.
async function categorizerStatus(): Promise<CategorizerStatus> {
  const llm = await categorizationLlm();
  return llm.caller.ready
    ? { ready: true, name: llm.name }
    : { ready: false, name: llm.name, reason: llm.caller.reason };
}

/*
 * Adding the one account the dropped files belong to.
 */

export type AddAccountOutcome =
  | { ok: true; added: AddAccountAdded }
  | {
      ok: false;
      code: AddAccountRefusal["code"];
      error: string;
      // For `import_refused`: the import's refusal, which the route words.
      importError?: ImportRefusal;
    };

type Refused = Extract<AddAccountOutcome, { ok: false }>;

function refused(code: AddAccountRefusal["code"], error: string): Refused {
  return { ok: false, code, error };
}

function importRefused(error: unknown): Refused {
  if (!isImportRefusal(error)) throw error;
  return {
    ok: false,
    code: "import_refused",
    error: error.message,
    importError: error,
  };
}

/**
 * Adds the bank or card the files belong to, and imports them. Refuses,
 * writing nothing, unless they are one account's, readable, not in the
 * books yet, and would go in as the import checks them, with the opening
 * that will be recorded. A new account is created with its preset entry
 * (or `fields.account_id`, an Asset or Liability no bank or card uses, is
 * tied to one); an `empty` one is finished as it is.
 */
export async function addAccount(
  ledger: Ledger,
  loadCategorizer: LoadCategorizer,
  files: readonly DroppedStatement[],
  fields: AddAccountFields,
): Promise<AddAccountOutcome> {
  const drop = await readDrop(ledger, files);
  const unreadable = drop.files.filter((file) => file.status !== "read");
  if (unreadable.length > 0) {
    return refused(
      "statement_unreadable",
      `dbu6 can't read ${unreadable.map((file) => file.file_name).join(", ")} yet. Teach it the format, then drop the files again.`,
    );
  }
  if (drop.shares.length !== 1) {
    return refused(
      "several_accounts",
      `These are from ${drop.shares.map((share) => candidateName(share.candidate)).join(" and ")}. Add one account's statements at a time.`,
    );
  }
  const [{ candidate, statements, lister, preset }] = drop.shares;
  const openingAmount = fields.opening_amount ?? null;

  switch (candidate.status) {
    case "in_books":
      return refused(
        "already_in_books",
        `${candidateName(candidate)} is already in your books. Import its statements on the Import page.`,
      );

    case "empty": {
      const account = candidate.account!;
      if (fields.account_id !== undefined && fields.account_id !== account.id) {
        return refused(
          "account_not_suitable",
          `These statements are ${account.name}'s, already one of your banks and cards.`,
        );
      }
      if (candidate.refusal instanceof AccountNotFoundError) {
        return refused(
          "opening_balance_refused",
          openingRefusal("account-not-found"),
        );
      }
      const checked = await checkBeforeWriting(
        ledger,
        loadCategorizer,
        {
          id: account.id,
          name: account.name,
          kind: candidate.kind!,
          mappingFiles: preset!.custom_mappings_filenames,
        },
        statements,
        openingAmount,
      );
      if (!checked.ok) return checked;

      // Its bank lists the parsers it lacks; an account set up with no
      // number takes the one the statements print.
      const changes = [
        ...changesListingParsers(
          loadImportPresets(ledger.db, ledger.auth),
          lister!.name,
          candidate.parsers,
        ),
        ...(candidate.identifier !== null &&
        preset!.account_identifiers.length === 0
          ? [
              {
                kind: "update_account" as const,
                account_id: account.id,
                account_identifiers: [candidate.identifier],
              },
            ]
          : []),
      ];
      if (changes.length > 0) {
        const changed = await changeImportPresets(ledger, changes);
        if (!changed.ok) {
          return refused(changed.problem.code, changed.problem.message);
        }
      }
      return importAdded(
        ledger,
        loadCategorizer,
        account,
        statements,
        checked.opening,
      );
    }

    case "new": {
      const kind = candidate.kind ?? fields.kind;
      // A parser belongs to one institution: the one listing it wins.
      const institution = lister?.name ?? fields.institution;
      if (kind === undefined) {
        return refused(
          "invalid_fields",
          "Say whether this is a bank account or a card.",
        );
      }
      if (institution === undefined) {
        return refused("invalid_fields", "Name the bank.");
      }
      let ledgerChoice: Extract<
        StatementAccountChange,
        { action: "create" }
      >["ledger"];
      let existing: { id: number; name: string } | null = null;
      if (fields.account_id !== undefined) {
        existing =
          loadAccountChart(ledger.db, ledger.auth).find(
            (one) => one.id === fields.account_id,
          ) ?? null;
        if (existing === null) {
          return refused(
            "account_not_suitable",
            "That account isn't in your books any more.",
          );
        }
        ledgerChoice = { source: "existing", account_id: existing.id };
      } else if (fields.name !== undefined) {
        const parentId =
          fields.parent_id ??
          loadStatementAccounts(ledger).default_parents[kind];
        if (parentId === null) {
          return refused("invalid_fields", "Pick a group for it.");
        }
        ledgerChoice = {
          source: "new",
          name: fields.name,
          parent_id: parentId,
        };
      } else {
        return refused(
          "invalid_fields",
          "Name the account, or pick one from your chart.",
        );
      }
      const name = existing?.name ?? fields.name!;

      // Everything that needs no account, before it is made.
      const checked = await checkBeforeWriting(
        ledger,
        loadCategorizer,
        {
          id: existing?.id ?? null,
          name,
          kind,
          mappingFiles: newStatementAccountMappingFiles(),
        },
        statements,
        openingAmount,
      );
      if (!checked.ok) return checked;
      // The account and its preset entry, with the parsers and the number.
      const created = await changeStatementAccount(
        ledger,
        {
          action: "create",
          kind,
          institution,
          identifier: candidate.identifier,
          ledger: ledgerChoice,
        },
        { parsers: candidate.parsers },
      );
      if (!created.ok) {
        return refused(
          creationCode(created.problem.code),
          created.problem.message,
        );
      }
      return importAdded(
        ledger,
        loadCategorizer,
        { id: created.accountId, name },
        statements,
        checked.opening,
      );
    }
  }
}

// The account as a refusal names it.
function candidateName(candidate: CandidateReading): string {
  if (candidate.account !== null) return candidate.account.name;
  const bank = candidate.institution || "a bank";
  return candidate.identifier === null
    ? bank
    : `${bank} ${candidate.identifier}`;
}

// A create refuses with none of the codes only a change or a removal gives,
// nor an invalid number: the statement's is canonical.
function creationCode(
  code: StatementAccountRefusal["code"],
): AddAccountRefusal["code"] {
  switch (code) {
    case "identifier_invalid":
    case "account_has_transactions":
      throw new Error(`Creating a bank or card refused with ${code}.`);
    default:
      return code;
  }
}

/*
 * `checkStatements`, and what the writes after it can be refused for that
 * doesn't depend on timing: an Opening Balances account that isn't Equity,
 * which refuses the opening entry; and the categorization config the import
 * will load, with the account's instruction files (`mappingFiles`).
 */
async function checkBeforeWriting(
  ledger: Ledger,
  loadCategorizer: LoadCategorizer,
  account: {
    id: number | null;
    name: string;
    kind: AccountKind;
    mappingFiles: readonly string[];
  },
  statements: readonly RecognizedStatement[],
  openingAmount: number | null,
): Promise<
  { ok: true; opening: { date: string; amount: number | null } } | Refused
> {
  const { opening, decision, importRefusal } = checkStatements(
    ledger,
    account,
    statements,
    openingAmount,
  );
  if (importRefusal !== null) return importRefused(importRefusal);
  if (opening === null || decision === null) {
    return refused(
      "statement_has_no_transactions",
      "The statement has no transactions to import.",
    );
  }
  if (!decision.ok) return decision;

  const equity = findOpeningBalancesAccount(ledger.db, ledger.auth);
  if (
    decision.amount !== null &&
    equity !== null &&
    equity.account_type !== "Equity"
  ) {
    return refused(
      "opening_balance_refused",
      openingRefusal("opening-balances-not-equity"),
    );
  }

  // What `categorize` needs once a row reaches it: every row does here.
  try {
    const categorizer = await loadCategorizer({
      customMappingsFilenames: [...account.mappingFiles],
      llm: await categorizationLlm(),
    });
    for (const part of [categorizer.classify, categorizer.customMappings]) {
      if (!part.ok && isImportRefusal(part.error)) {
        return importRefused(part.error);
      }
    }
  } catch (error) {
    return importRefused(error);
  }
  return { ok: true, opening: { date: opening.date, amount: decision.amount } };
}

/*
 * The writes after the account's preset: the opening entry the day before
 * the first row, unless the account has one that agrees (`amount` null);
 * then /import's tail, categorization included, on the account as the
 * presets have it now. A refusal of the import's own is `import_refused`.
 */
async function importAdded(
  ledger: Ledger,
  loadCategorizer: LoadCategorizer,
  account: { id: number; name: string },
  statements: readonly RecognizedStatement[],
  opening: { date: string; amount: number | null },
): Promise<AddAccountOutcome> {
  if (opening.amount !== null) {
    const recorded = recordOpeningBalance(ledger, {
      accountId: account.id,
      date: opening.date,
      amount: opening.amount,
    });
    // Recorded meanwhile by another request: the statements go in on it.
    if (recorded.kind !== "recorded" && recorded.kind !== "already-recorded") {
      return refused("opening_balance_refused", openingRefusal(recorded.kind));
    }
  }

  const home = presetHome(
    loadImportPresets(ledger.db, ledger.auth),
    account.id,
  );
  if (home === null) {
    return refused(
      "unknown_account",
      "That bank or card isn't set up any more.",
    );
  }
  // Whatever number they print, the statements are this account's.
  const outcome = await importPlannedGroups(
    statements.map((one) => ({
      status: "resolved",
      file: one.file,
      accountId: account.id,
      accountName: home.account.name,
      parserName: one.parserName,
      account: one.statement.account,
      institution: one.statement.institution,
    })),
    [{ ...home, statements: [...statements] }],
    null,
    ledger,
    loadCategorizer,
  );
  switch (outcome.kind) {
    case "failed":
      return importRefused(outcome.error);
    case "unplanned":
      throw new Error("A planned import came back unplanned.");
    case "imported":
      return {
        ok: true,
        added: {
          account_id: account.id,
          account_name: account.name,
          drafts: outcome.imported.reduce(
            (sum, one) => sum + one.result.draft_transaction_count,
            0,
          ),
        },
      };
  }
}

type OpeningCode =
  | "opening_after_statement_start"
  | "opening_disagrees"
  | "opening_balance_needed"
  | "activity_before_statement";

type OpeningDecision =
  // The amount to record, or null to record none: the account has one.
  | { ok: true; amount: number | null }
  | { ok: false; code: OpeningCode; error: string };

/*
 * The opening entry the import records, or why it can't go ahead. An
 * account with an opening entry keeps it, as long as the statement starts
 * after it: rows on or before its date would fall behind the balance the
 * books already check, and the import would drop them. When it is dated
 * the day before the statement starts, it must be the statement's balance
 * there. Else the opening is the statement's, or the typed one; and nothing
 * may sit on the account before it, which only another account's import can
 * have posted (a card payment from the bank's statement, say): the opening
 * would then check a balance that already moved. `accountId` is null for an
 * account not in the books yet, which has neither.
 */
function openingToRecord(
  ledger: Ledger,
  accountId: number | null,
  // The day before the first row, and the balance the statements give it.
  opening: StatementOpening,
  typedAmount: number | null,
): OpeningDecision {
  const existing =
    accountId === null
      ? undefined
      : loadOpeningEntries(ledger.sqlite, ledger.auth, { accountId }).get(
          accountId,
        );
  const starts = opening.date;
  const firstDate = Temporal.PlainDate.from(starts).add({ days: 1 }).toString();
  if (existing !== undefined) {
    if (existing.date > starts) {
      return {
        ok: false,
        code: "opening_after_statement_start",
        error: `Your books start this account on ${existing.date}, but this statement begins on ${firstDate}. Upload a statement that starts after ${existing.date}.`,
      };
    }
    if (
      existing.date === starts &&
      opening.amount !== null &&
      !sameAmount(existing.amount, opening.amount)
    ) {
      return {
        ok: false,
        code: "opening_disagrees",
        error: `Your books open this account at ${money.format(existing.amount)} on ${existing.date}, but this statement starts from ${money.format(opening.amount)}. Upload the statement that follows on from it.`,
      };
    }
    return { ok: true, amount: null };
  }

  const amount = opening.amount ?? typedAmount;
  if (amount === null) {
    return {
      ok: false,
      code: "opening_balance_needed",
      error: `The statement prints no balances. Enter what the account held on ${starts}.`,
    };
  }
  const first =
    accountId === null
      ? null
      : loadOpeningBalances(ledger).accounts.find(
          (one) => one.accountId === accountId,
        )?.firstActivityDate;
  if (first !== undefined && first !== null && first <= starts) {
    return {
      ok: false,
      code: "activity_before_statement",
      error: `Another account's statement put a transaction on this account on ${first}, before this statement begins. Upload an earlier statement, one that covers ${first}.`,
    };
  }
  return { ok: true, amount };
}

/** The institution and preset account that list the ledger account. */
function presetHome(
  presets: readonly ImportInstitution[],
  accountId: number,
): { institution: ImportInstitution; account: ImportAccount } | null {
  for (const institution of presets) {
    const account = institution.accounts.find(
      (one) => one.account_id === accountId,
    );
    if (account !== undefined) return { institution, account };
  }
  return null;
}

/** The words for an opening entry the import couldn't post. */
function openingRefusal(
  kind:
    | "account-not-found"
    | "not-asset-or-liability"
    | "date-not-before-first-activity"
    | "opening-balances-not-equity",
): string {
  switch (kind) {
    case "account-not-found":
      return "The account was deleted from your books.";
    case "not-asset-or-liability":
      return "The account isn't an asset or a liability, so it takes no opening balance.";
    case "date-not-before-first-activity":
      return "The account has transactions before this statement starts.";
    case "opening-balances-not-equity":
      return "Your books have an account named Opening Balances that isn't Equity. Rename it on the Accounts page.";
  }
}

// An amount as the screens show one, in a refusal's words.
const money = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * What a bank or card holds so far: posted entries (its opening entry left
 * out) and drafts from its own statements.
 */
export interface StatementActivity {
  entries: number;
  drafts: number;
}

/**
 * Whether a bank or card's first statement is in: it has entries or drafts.
 * It is then `in_books`, and Home counts it imported.
 */
export function hasTransactions(activity: StatementActivity): boolean {
  return activity.entries > 0 || activity.drafts > 0;
}

/**
 * Each account's own entries (`countOwnEntriesByAccount`), its opening entry
 * left out, and the drafts from its own statements. The one rule for whether
 * a bank or card is imported: /add's reading and Home's "nothing imported
 * yet" both read it.
 */
export function loadStatementActivity(
  ledger: Pick<Ledger, "sqlite" | "auth">,
): (accountId: number) => StatementActivity {
  const { sqlite, auth } = ledger;
  // Its own: a card payment another account's import posted to it is not
  // this account's statement.
  const entries = countOwnEntriesByAccount(sqlite, auth);
  const openings = loadOpeningEntries(sqlite, auth);
  const drafts = loadDraftStatus(sqlite, auth);
  return (accountId) => ({
    entries: (entries.get(accountId) ?? 0) - (openings.has(accountId) ? 1 : 0),
    drafts: drafts.get(accountId)?.drafts ?? 0,
  });
}
