import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Abacus } from "../../modules/statement/index.js";
import { parseAccount, UNCATEGORIZED } from "../../modules/values/index.js";

// Mock the Nuabase-touching module so resolve runs as a pure pipeline.
vi.mock("./llm-categorization.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./llm-categorization.js")>()),
  categorizeViaLLM: vi.fn(),
}));

import { CategorizationConfigError, resolveCategories } from "./resolve.js";
import {
  categorizeViaLLM,
  type CategorizationLlm,
  type LLMCategorization,
} from "./llm-categorization.js";
import { PROMPT_TEMPLATE } from "./prompt-template.js";

const llmMock = categorizeViaLLM as unknown as ReturnType<typeof vi.fn>;

// categorizeViaLLM is mocked, so the engine is only passed along.
const llm: CategorizationLlm = {
  agent: "claude-code",
  name: "Claude Code",
  caller: { ready: false, reason: "not called in these tests" },
};

function answered(
  mappings: LLMCategorization["mappings"],
  report: Partial<LLMCategorization["report"]> = {},
): LLMCategorization {
  return {
    mappings,
    report: {
      agent: "claude-code",
      sent_count: Object.keys(mappings).length,
      failed_count: 0,
      error: null,
      ...report,
    },
  };
}

let dir: string;

function withdrawal(narration: string, amount = 100): Abacus {
  return {
    date: "2026-01-01",
    narration,
    withdrawal: amount,
    deposit: 0,
    balance: 0,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "resolve-test-"));
  writeFileSync(
    join(dir, "transaction_mappings.mjs"),
    `export const mappings = {
      exact: { STARBUCKS: "expenses:food" },
      includes: [],
    };`,
  );
  writeFileSync(join(dir, "hledger_accounts.prompt"), "expenses:food");
  writeFileSync(join(dir, "custom-a.txt"), "MAP A");
  writeFileSync(join(dir, "custom-b.txt"), "MAP B");
  llmMock.mockReset();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const baseConfig = () => ({
  userConfigDir: dir,
  customMappingsFilenames: ["custom-a.txt", "custom-b.txt"],
  llm,
});

describe("resolveCategories", () => {
  it("uses executable mappings without calling the LLM when all transactions match", async () => {
    llmMock.mockResolvedValue(answered({}));
    const txns = [withdrawal("STARBUCKS")];
    const result = await resolveCategories(txns, baseConfig());

    expect(result).toEqual({
      categorized: [
        { transaction: txns[0], account: parseAccount("expenses:food") },
      ],
      report: {
        agent: "claude-code",
        sent_count: 0,
        failed_count: 0,
        error: null,
      },
    });
    expect(llmMock).not.toHaveBeenCalled();
  });

  it("calls the LLM with merged custom mappings, prompt context, and unmapped indices", async () => {
    llmMock.mockResolvedValue(
      answered({ MYSTERY: parseAccount("expenses:other") }),
    );
    const txns = [withdrawal("STARBUCKS"), withdrawal("MYSTERY")];

    await resolveCategories(txns, baseConfig());

    expect(llmMock).toHaveBeenCalledTimes(1);
    const [passedTxns, unmappedIndices, llmConfig] = llmMock.mock.calls[0];
    expect(passedTxns).toBe(txns);
    expect(unmappedIndices).toEqual([1]);
    expect(llmConfig).toEqual({
      promptTemplate: PROMPT_TEMPLATE,
      hledgerAccounts: "expenses:food",
      customMappings: "MAP A\n\nMAP B",
      llm,
    });
  });

  it("ignores missing optional custom mapping files", async () => {
    llmMock.mockResolvedValue(
      answered({ MYSTERY: parseAccount("expenses:other") }),
    );
    const txns = [withdrawal("MYSTERY")];

    await resolveCategories(txns, {
      ...baseConfig(),
      customMappingsFilenames: [
        "custom-a.txt",
        "missing-custom.txt",
        "custom-b.txt",
      ],
    });

    const [, , llmConfig] = llmMock.mock.calls[0];
    expect(llmConfig.customMappings).toBe("MAP A\n\nMAP B");
  });

  it("throws an actionable config error when executable mappings are missing", async () => {
    rmSync(join(dir, "transaction_mappings.mjs"));

    await expect(
      resolveCategories([withdrawal("MYSTERY")], baseConfig()),
    ).rejects.toThrow(CategorizationConfigError);
    await expect(
      resolveCategories([withdrawal("MYSTERY")], baseConfig()),
    ).rejects.toThrow(
      /Missing required categorization config file: .*transaction_mappings\.mjs/,
    );
  });

  it("throws an actionable config error when hledger_accounts.prompt is missing and the LLM is needed", async () => {
    rmSync(join(dir, "hledger_accounts.prompt"));

    await expect(
      resolveCategories([withdrawal("MYSTERY")], baseConfig()),
    ).rejects.toThrow(CategorizationConfigError);
    await expect(
      resolveCategories([withdrawal("MYSTERY")], baseConfig()),
    ).rejects.toThrow(
      /Missing required categorization config file: .*hledger_accounts\.prompt/,
    );
    expect(llmMock).not.toHaveBeenCalled();
  });

  it("throws an actionable config error when the mappings export is the wrong shape", async () => {
    const badDir = mkdtempSync(join(tmpdir(), "resolve-test-bad-"));
    writeFileSync(
      join(badDir, "transaction_mappings.mjs"),
      `export function classify() { return null; }`,
    );

    await expect(
      resolveCategories([withdrawal("MYSTERY")], {
        ...baseConfig(),
        userConfigDir: badDir,
      }),
    ).rejects.toThrow(/must export a "mappings" object/);

    rmSync(badDir, { recursive: true, force: true });
  });

  it("merges executable + LLM mappings into the final categorized list", async () => {
    llmMock.mockResolvedValue(
      answered({ MYSTERY: parseAccount("expenses:other") }),
    );
    const txns = [withdrawal("STARBUCKS"), withdrawal("MYSTERY")];

    const result = await resolveCategories(txns, baseConfig());
    expect(result.categorized.map((r) => r.account)).toEqual([
      "expenses:food",
      "expenses:other",
    ]);
  });

  it("passes the LLM's report up with the categorized transactions", async () => {
    llmMock.mockResolvedValue(
      answered({}, { sent_count: 1, failed_count: 1, error: "sample failure" }),
    );

    const result = await resolveCategories(
      [withdrawal("STARBUCKS"), withdrawal("MYSTERY")],
      baseConfig(),
    );

    expect(result.categorized.map((r) => r.account)).toEqual([
      "expenses:food",
      UNCATEGORIZED,
    ]);
    expect(result.report).toEqual({
      agent: "claude-code",
      sent_count: 1,
      failed_count: 1,
      error: "sample failure",
    });
  });

  it("leaves unresolved withdrawals uncategorized at the review-range boundaries", async () => {
    llmMock.mockResolvedValue(answered({}));
    const txns = [
      withdrawal("UNKNOWN UNDER 200", 199.99),
      withdrawal("UNKNOWN AT 200", 200),
      withdrawal("UNKNOWN AT 500", 500),
    ];

    const result = await resolveCategories(txns, baseConfig());
    expect(result.categorized.map((r) => r.account)).toEqual([
      UNCATEGORIZED,
      UNCATEGORIZED,
      UNCATEGORIZED,
    ]);
  });

  it("skips the LLM call entirely when there are no unmapped transactions", async () => {
    llmMock.mockResolvedValue(answered({}));
    await resolveCategories([withdrawal("STARBUCKS")], baseConfig());
    expect(llmMock).not.toHaveBeenCalled();
  });
});
