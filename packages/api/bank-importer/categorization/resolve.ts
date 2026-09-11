import { readFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import type { Abacus } from "../abacus/index.js";
import type { CategorizedTransaction } from "../domain/CategorizedTransaction.js";
import type { Account } from "../domain/Account.js";
import { parseAccount, UNCATEGORIZED } from "../domain/Account.js";
import { categorizeViaLLM } from "./llm-categorization.js";
import { PROMPT_TEMPLATE } from "./prompt-template.js";
import {
  classifyWith,
  compileMappings,
  mappingRulesSchema,
} from "./mapping-rules.js";
import { ApiImportError } from "../import-errors.js";

export interface CategorizationConfig {
  userConfigDir: string;
  customMappingsFilenames: string[];
  nuabaseApiKey: string;
}

export class CategorizationConfigError extends ApiImportError {
  readonly status = 400;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CategorizationConfigError";
  }

  toPayload(): Record<string, unknown> {
    return {
      error: "categorization_config_error",
      message: this.message,
    };
  }
}

const TRANSACTION_MAPPINGS_FILENAME = "transaction_mappings.mjs";
const HLEDGER_ACCOUNTS_FILENAME = "hledger_accounts.prompt";

type TransactionClassifier = (transaction: Abacus) => Account | null;

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function readRequiredConfigFile(
  userConfigDir: string,
  filename: string,
): string {
  const filePath = join(userConfigDir, filename);
  try {
    return readFileSync(filePath, "utf-8");
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new CategorizationConfigError(
        `Missing required categorization config file: ${filePath}. ` +
          `Create ${filename} in ${userConfigDir}, or run \`pnpm setup\` to ` +
          `seed it from user-config.example/.`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function loadTransactionClassifier(
  userConfigDir: string,
): Promise<TransactionClassifier> {
  const filePath = join(userConfigDir, TRANSACTION_MAPPINGS_FILENAME);
  readRequiredConfigFile(userConfigDir, TRANSACTION_MAPPINGS_FILENAME);

  let loaded: Record<string, unknown>;
  try {
    loaded = await import(pathToFileURL(filePath).href);
  } catch (error) {
    throw new CategorizationConfigError(
      `Invalid categorization config file: ${filePath}. ` +
        `${TRANSACTION_MAPPINGS_FILENAME} must be a valid JavaScript module.`,
      { cause: error },
    );
  }

  const rules = mappingRulesSchema.safeParse(loaded.mappings);
  if (!rules.success) {
    throw new CategorizationConfigError(
      `Invalid categorization config file: ${filePath}. ` +
        `${TRANSACTION_MAPPINGS_FILENAME} must export a "mappings" object of ` +
        `{ exact, includes }: ${rules.error.message}`,
    );
  }

  let compiled;
  try {
    compiled = compileMappings(rules.data);
  } catch (error) {
    throw new CategorizationConfigError(
      `Invalid categorization config file: ${filePath}. ` +
        `${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  return (transaction) => {
    const account = classifyWith(compiled, transaction);
    return account === null ? null : parseAccount(account);
  };
}

function partitionByClassifier(
  transactions: Abacus[],
  classify: TransactionClassifier,
): { mapped: Record<string, Account>; unmappedIndices: number[] } {
  const mapped: Record<string, Account> = {};
  const unmappedIndices: number[] = [];

  transactions.forEach((transaction, index) => {
    if (transaction.narration in mapped) return;

    const account = classify(transaction);
    if (account) mapped[transaction.narration] = account;
    else unmappedIndices.push(index);
  });

  return { mapped, unmappedIndices };
}

function loadCustomMappings(
  filenames: string[],
  userConfigDir: string,
): string {
  return filenames
    .flatMap((filename) => {
      try {
        return [readFileSync(join(userConfigDir, filename), "utf-8")];
      } catch (error) {
        if (isMissingFileError(error)) return [];
        throw error;
      }
    })
    .join("\n\n");
}

/**
 * Full categorization resolution:
 *   1. Apply executable transaction mappings
 *   2. Call LLM for unmapped transactions via Nuabase
 *   3. Combine all mappings
 */
export async function resolveCategories(
  transactions: Abacus[],
  config: CategorizationConfig,
): Promise<CategorizedTransaction[]> {
  // 1. Apply the authoritative executable mappings before asking the LLM.
  const classifier = await loadTransactionClassifier(config.userConfigDir);
  const { mapped, unmappedIndices } = partitionByClassifier(
    transactions,
    classifier,
  );

  // 2. Call LLM for unmapped transactions
  let llmMappings: Record<string, Account> = {};
  if (unmappedIndices.length > 0) {
    const hledgerAccounts = readRequiredConfigFile(
      config.userConfigDir,
      HLEDGER_ACCOUNTS_FILENAME,
    );
    const customMappings = loadCustomMappings(
      config.customMappingsFilenames,
      config.userConfigDir,
    );

    llmMappings = await categorizeViaLLM(transactions, unmappedIndices, {
      promptTemplate: PROMPT_TEMPLATE,
      hledgerAccounts,
      customMappings,
      nuabaseApiKey: config.nuabaseApiKey,
    });
  }

  // 3. Combine all mappings and build result
  const allMappings: Record<string, Account> = { ...mapped, ...llmMappings };
  return transactions.map((t) => ({
    transaction: t,
    account: allMappings[t.narration] ?? UNCATEGORIZED,
  }));
}
