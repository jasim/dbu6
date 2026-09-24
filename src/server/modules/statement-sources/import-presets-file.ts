import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  parserNameSchema,
  statementAccountIdentifierSchema,
  type ImportAccount,
} from "../../../shared/index.js";
import { userConfigDir } from "../../paths.js";
import type { PresetInstitution } from "./import-preset-changes.js";

/*
 * user-config/import-presets.json, from before presets moved into the
 * import_presets table: reading it, turning its presets into institutions,
 * and deleting it once the table holds them. Nothing else reads it.
 *
 * The file held one preset per account and statement format. Presets that
 * share a parser or an account become one institution, and the presets of
 * one account become one account.
 */

// One preset of the file: one account and one statement format.
const importPresetSchema = z.object({
  name: z.string().min(1),
  // The ledger account's name.
  base_account: z.string().min(1),
  custom_mappings_filenames: z.array(z.string()),
  is_credit_card: z.boolean().optional(),
  custom_statement_parser_path: parserNameSchema.optional(),
  // The account or card number the preset's statements print.
  statement_account_identifier: statementAccountIdentifierSchema.optional(),
});
export type ImportPreset = z.infer<typeof importPresetSchema>;

const importPresetsFileSchema = z.array(importPresetSchema);

const IMPORT_PRESETS_FILE = "import-presets.json";

/** The file in `root`'s user-config/, the running project's by default. */
export function importPresetsFilePath(root?: string): string {
  return join(userConfigDir(root), IMPORT_PRESETS_FILE);
}

/** The file's presets, or null when there is no file. Malformed throws. */
export async function readImportPresetsFile(
  root?: string,
): Promise<ImportPreset[] | null> {
  let raw: string;
  try {
    raw = await readFile(importPresetsFilePath(root), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return importPresetsFileSchema.parse(JSON.parse(raw));
}

export async function deleteImportPresetsFile(root?: string): Promise<void> {
  await rm(importPresetsFilePath(root));
}

export type ImportPresetsFileConversion =
  | { ok: true; institutions: PresetInstitution[]; warnings: string[] }
  | {
      ok: false;
      code: "unresolved_base_accounts" | "conflicting_is_credit_card";
      message: string;
      // The base_account names the refusal is about.
      names: string[];
    };

/**
 * The institutions the file's presets become, given each ledger account's id
 * by its name. Refuses a base_account the ledger lacks, and presets of one
 * account that disagree on is_credit_card.
 */
export function convertImportPresetsFile(
  presets: readonly ImportPreset[],
  accountIds: ReadonlyMap<string, number>,
): ImportPresetsFileConversion {
  const unresolved = [
    ...new Set(
      presets
        .map((preset) => preset.base_account)
        .filter((name) => !accountIds.has(name)),
    ),
  ];
  if (unresolved.length > 0) {
    return {
      ok: false,
      code: "unresolved_base_accounts",
      message: `No ledger account is named ${unresolved.map((name) => `"${name}"`).join(", ")}, which import-presets.json names as base_account. Rename the account or the preset's base_account so they match.`,
      names: unresolved,
    };
  }

  const institutions: PresetInstitution[] = [];
  const warnings: string[] = [];
  for (const group of groupIntoInstitutions(presets)) {
    const accounts: ImportAccount[] = [];
    for (const [baseAccount, ofAccount] of byBaseAccount(group)) {
      const merged = mergeIntoAccount(
        accountIds.get(baseAccount)!,
        baseAccount,
        ofAccount,
      );
      if (!merged.ok) return merged;
      accounts.push(merged.account);
      if (merged.warning) warnings.push(merged.warning);
    }
    institutions.push({
      id: null,
      name: group[0].name,
      parsers: unique(
        group.flatMap((preset) =>
          preset.custom_statement_parser_path === undefined
            ? []
            : [preset.custom_statement_parser_path],
        ),
      ),
      accounts,
    });
  }
  return { ok: true, institutions, warnings };
}

/**
 * The presets in groups, in file order: two presets are in one group when
 * they share a parser or a base_account, directly or through others.
 */
export function groupIntoInstitutions(
  presets: readonly ImportPreset[],
): ImportPreset[][] {
  const parent = presets.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (a: number, b: number) => {
    const [rootA, rootB] = [find(a), find(b)];
    // The earlier preset stays the root, so a group is named after its first.
    if (rootA !== rootB)
      parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
  };

  const firstWith = new Map<string, number>();
  presets.forEach((preset, index) => {
    const keys = [`account:${preset.base_account}`];
    if (preset.custom_statement_parser_path !== undefined) {
      keys.push(`parser:${preset.custom_statement_parser_path}`);
    }
    for (const key of keys) {
      const first = firstWith.get(key);
      if (first === undefined) firstWith.set(key, index);
      else union(first, index);
    }
  });

  const groups = new Map<number, ImportPreset[]>();
  presets.forEach((preset, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group) group.push(preset);
    else groups.set(root, [preset]);
  });
  return [...groups.values()];
}

function byBaseAccount(
  presets: readonly ImportPreset[],
): Map<string, ImportPreset[]> {
  const accounts = new Map<string, ImportPreset[]>();
  for (const preset of presets) {
    const ofAccount = accounts.get(preset.base_account);
    if (ofAccount) ofAccount.push(preset);
    else accounts.set(preset.base_account, [preset]);
  }
  return accounts;
}

/**
 * One account from the presets that import into it: the first preset's name,
 * every identifier they carry, and every instruction file they list, in the
 * order first seen. A warning says when their instruction files differed.
 */
export function mergeIntoAccount(
  accountId: number,
  baseAccount: string,
  presets: readonly ImportPreset[],
):
  | { ok: true; account: ImportAccount; warning: string | null }
  | Extract<ImportPresetsFileConversion, { ok: false }> {
  const isCreditCard = presets[0].is_credit_card === true;
  if (
    presets.some((preset) => (preset.is_credit_card === true) !== isCreditCard)
  ) {
    return {
      ok: false,
      code: "conflicting_is_credit_card",
      message: `The presets for "${baseAccount}" (${presets.map((preset) => `"${preset.name}"`).join(", ")}) disagree on is_credit_card. Make them agree.`,
      names: [baseAccount],
    };
  }

  const filenames = unique(
    presets.flatMap((preset) => preset.custom_mappings_filenames),
  );
  const differed = presets.some(
    (preset) =>
      JSON.stringify(unique(preset.custom_mappings_filenames)) !==
      JSON.stringify(unique(presets[0].custom_mappings_filenames)),
  );
  return {
    ok: true,
    account: {
      account_id: accountId,
      name: presets[0].name,
      is_credit_card: isCreditCard,
      account_identifiers: unique(
        presets.flatMap((preset) =>
          preset.statement_account_identifier === undefined
            ? []
            : [preset.statement_account_identifier],
        ),
      ),
      custom_mappings_filenames: filenames,
    },
    warning: differed
      ? `The presets for "${baseAccount}" (${presets.map((preset) => `"${preset.name}"`).join(", ")}) listed different instruction files; the account now lists all of them, in the order first seen: ${filenames.join(", ")}.`
      : null,
  };
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
