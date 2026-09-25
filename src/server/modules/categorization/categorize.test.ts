import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Abacus } from "../statement/index.js";
import { parseAccount, UNCATEGORIZED } from "../values/index.js";

// Mock the Nuabase-touching module so categorization runs as a pure pipeline.
vi.mock("./llm-categorization.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./llm-categorization.js")>()),
  categorizeViaLLM: vi.fn(),
}));

import {
  CategorizationConfigError,
  loadCategorizer,
  type CategorizerSettings,
} from "./load-categorizer.js";
import { categorize, tallyCategorization } from "./categorize.js";
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
      failure: null,
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
      exact: { STARBUCKS: "Food" },
      includes: [],
    };`,
  );
  writeFileSync(join(dir, "custom-a.txt"), "MAP A");
  writeFileSync(join(dir, "custom-b.txt"), "MAP B");
  llmMock.mockReset();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const baseConfig = (): CategorizerSettings => ({
  customMappingsFilenames: ["custom-a.txt", "custom-b.txt"],
  llm,
});

const ACCOUNTS = new Map([
  ["Food", { id: 11, account_type: "Expense" }],
  ["Other Expenses", { id: 12, account_type: "Expense" }],
  ["Sample Bank", { id: 21, account_type: "Asset" }],
  ["Opening Balances", { id: 41, account_type: "Equity" }],
] as const);

// Loads the config in `configDir` and categorizes rows on a statement of an
// account the ledger doesn't hold.
async function categorizeRows(
  txns: Abacus[],
  settings: CategorizerSettings,
  configDir = dir,
) {
  return categorize(
    await loadCategorizer(settings, configDir),
    txns.map((transaction) => ({ transaction, baseAccountId: null })),
    ACCOUNTS,
  );
}

describe("categorize", () => {
  it("uses executable mappings without calling the LLM when all transactions match", async () => {
    llmMock.mockResolvedValue(answered({}));
    const txns = [withdrawal("STARBUCKS")];
    const result = await categorizeRows(txns, baseConfig());

    expect(result).toEqual({
      rows: [
        {
          transaction: txns[0],
          account: parseAccount("Food"),
          accountId: 11,
          outcome: "rule",
        },
      ],
      sameAccountSkips: [],
      report: {
        agent: "claude-code",
        sent_count: 0,
        failed_count: 0,
        error: null,
        failure: null,
      },
    });
    expect(llmMock).not.toHaveBeenCalled();
  });

  it("calls the LLM with merged custom mappings, prompt context, and unmapped indices", async () => {
    llmMock.mockResolvedValue(
      answered({ MYSTERY: parseAccount("Other Expenses") }),
    );
    const txns = [withdrawal("STARBUCKS"), withdrawal("MYSTERY")];

    await categorizeRows(txns, baseConfig());

    expect(llmMock).toHaveBeenCalledTimes(1);
    const [passedTxns, unmappedIndices, llmConfig] = llmMock.mock.calls[0];
    expect(passedTxns).toEqual(
      txns.map((transaction) => ({ transaction, statementAccount: null })),
    );
    expect(unmappedIndices).toEqual([1]);
    expect(llmConfig).toEqual({
      promptTemplate: PROMPT_TEMPLATE,
      accounts: "Food\nOther Expenses\nSample Bank",
      customMappings: "MAP A\n\nMAP B",
      llm,
    });
  });

  it("tells the LLM each row's statement account by name", async () => {
    llmMock.mockResolvedValue(answered({}));
    const onTheBank = withdrawal("MYSTERY");
    const onNoAccount = withdrawal("OTHER MYSTERY");

    await categorize(
      await loadCategorizer(baseConfig(), dir),
      [
        { transaction: onTheBank, baseAccountId: 21 },
        { transaction: onNoAccount, baseAccountId: null },
      ],
      ACCOUNTS,
    );

    const [passedTxns] = llmMock.mock.calls[0];
    expect(passedTxns).toEqual([
      { transaction: onTheBank, statementAccount: "Sample Bank" },
      { transaction: onNoAccount, statementAccount: null },
    ]);
  });

  it("offers the LLM the ledger's accounts but Equity, by name, and not hledger_accounts.prompt", async () => {
    writeFileSync(join(dir, "hledger_accounts.prompt"), "Stale Account");
    llmMock.mockResolvedValue(answered({}));

    await categorizeRows([withdrawal("MYSTERY")], baseConfig());

    const [, , llmConfig] = llmMock.mock.calls[0];
    expect(llmConfig.accounts.split("\n")).toEqual([
      "Food",
      "Other Expenses",
      "Sample Bank",
    ]);
  });

  it("ignores missing optional custom mapping files", async () => {
    llmMock.mockResolvedValue(
      answered({ MYSTERY: parseAccount("Other Expenses") }),
    );
    const txns = [withdrawal("MYSTERY")];

    await categorizeRows(txns, {
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
      categorizeRows([withdrawal("MYSTERY")], baseConfig()),
    ).rejects.toThrow(CategorizationConfigError);
    await expect(
      categorizeRows([withdrawal("MYSTERY")], baseConfig()),
    ).rejects.toThrow(
      /Missing required categorization config file: .*transaction_mappings\.mjs/,
    );
  });

  it("throws an actionable config error when the mappings export is the wrong shape", async () => {
    const badDir = mkdtempSync(join(tmpdir(), "resolve-test-bad-"));
    writeFileSync(
      join(badDir, "transaction_mappings.mjs"),
      `export function classify() { return null; }`,
    );

    await expect(
      categorizeRows([withdrawal("MYSTERY")], baseConfig(), badDir),
    ).rejects.toThrow(/must export a "mappings" object/);

    rmSync(badDir, { recursive: true, force: true });
  });

  it("merges executable + LLM mappings into the final categorized list", async () => {
    llmMock.mockResolvedValue(
      answered({ MYSTERY: parseAccount("Other Expenses") }),
    );
    const txns = [withdrawal("STARBUCKS"), withdrawal("MYSTERY")];

    const result = await categorizeRows(txns, baseConfig());
    expect(result.rows.map((r) => r.account)).toEqual([
      "Food",
      "Other Expenses",
    ]);
  });

  it("passes the LLM's report up with the categorized transactions", async () => {
    llmMock.mockResolvedValue(
      answered(
        {},
        {
          sent_count: 1,
          failed_count: 1,
          error: "sample failure",
          failure: "partial",
        },
      ),
    );

    const result = await categorizeRows(
      [withdrawal("STARBUCKS"), withdrawal("MYSTERY")],
      baseConfig(),
    );

    expect(result.rows.map((r) => r.account)).toEqual(["Food", UNCATEGORIZED]);
    expect(result.report).toEqual({
      agent: "claude-code",
      sent_count: 1,
      failed_count: 1,
      error: "sample failure",
      failure: "partial",
    });
  });

  it("leaves unresolved withdrawals uncategorized at the review-range boundaries", async () => {
    llmMock.mockResolvedValue(answered({}));
    const txns = [
      withdrawal("UNKNOWN UNDER 200", 199.99),
      withdrawal("UNKNOWN AT 200", 200),
      withdrawal("UNKNOWN AT 500", 500),
    ];

    const result = await categorizeRows(txns, baseConfig());
    expect(result.rows.map((r) => r.account)).toEqual([
      UNCATEGORIZED,
      UNCATEGORIZED,
      UNCATEGORIZED,
    ]);
  });

  it("skips the LLM call entirely when there are no unmapped transactions", async () => {
    llmMock.mockResolvedValue(answered({}));
    await categorizeRows([withdrawal("STARBUCKS")], baseConfig());
    expect(llmMock).not.toHaveBeenCalled();
  });

  it("needs no config file when there is nothing to categorize", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "resolve-test-empty-"));
    try {
      const result = await categorizeRows([], baseConfig(), emptyDir);
      expect(result).toEqual({
        rows: [],
        sameAccountSkips: [],
        report: {
          agent: "claude-code",
          sent_count: 0,
          failed_count: 0,
          error: null,
          failure: null,
        },
      });
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("gives each answer's ledger account id and who answered, and none for an account the ledger doesn't hold", async () => {
    llmMock.mockResolvedValue(
      answered({
        MYSTERY: parseAccount("Other Expenses"),
        UNKNOWN: parseAccount("Not In Ledger"),
      }),
    );

    const result = await categorizeRows(
      [
        withdrawal("STARBUCKS"),
        withdrawal("MYSTERY"),
        withdrawal("UNKNOWN"),
        withdrawal("UNANSWERED"),
      ],
      baseConfig(),
    );
    expect(
      result.rows.map(({ account, accountId, outcome }) => ({
        account,
        accountId,
        outcome,
      })),
    ).toEqual([
      { account: "Food", accountId: 11, outcome: "rule" },
      { account: "Other Expenses", accountId: 12, outcome: "llm" },
      { account: "Not In Ledger", accountId: null, outcome: "uncategorized" },
      { account: UNCATEGORIZED, accountId: null, outcome: "uncategorized" },
    ]);
  });

  it("leaves a row uncategorized and records a skip when the answer is its own base account", async () => {
    llmMock.mockResolvedValue(
      answered({ "to my sample": parseAccount("Sample Bank") }),
    );
    const onTheBank = withdrawal("to my sample", 1000);
    const onACard = withdrawal("to my sample", 1000);

    const result = await categorize(
      await loadCategorizer(baseConfig(), dir),
      [
        { transaction: onTheBank, baseAccountId: 21 },
        { transaction: onACard, baseAccountId: 31 },
      ],
      ACCOUNTS,
    );

    expect(result.rows).toEqual([
      {
        transaction: onTheBank,
        account: "Sample Bank",
        accountId: null,
        outcome: "same-account",
      },
      {
        transaction: onACard,
        account: "Sample Bank",
        accountId: 21,
        outcome: "llm",
      },
    ]);
    expect(result.sameAccountSkips).toEqual([
      {
        date: "2026-01-01",
        narration: "to my sample",
        account: "Sample Bank",
      },
    ]);
  });
});

describe("tallyCategorization", () => {
  it("counts each row once by who categorized it, and each account's rows, most first", async () => {
    llmMock.mockResolvedValue(
      answered({
        MYSTERY: parseAccount("Other Expenses"),
        "to my sample": parseAccount("Sample Bank"),
      }),
    );
    const result = await categorize(
      await loadCategorizer(baseConfig(), dir),
      [
        withdrawal("STARBUCKS"),
        withdrawal("MYSTERY"),
        withdrawal("MYSTERY", 200),
        withdrawal("to my sample"),
        withdrawal("UNANSWERED"),
      ].map((transaction) => ({ transaction, baseAccountId: 21 })),
      ACCOUNTS,
    );

    expect(tallyCategorization(result.rows)).toEqual({
      by_rule: 1,
      by_llm: 2,
      same_account: 1,
      uncategorized: 1,
      accounts: [
        { account_id: 12, account_name: "Other Expenses", count: 2 },
        { account_id: 11, account_name: "Food", count: 1 },
      ],
    });
  });

  it("is all zero for no rows", () => {
    expect(tallyCategorization([])).toEqual({
      by_rule: 0,
      by_llm: 0,
      same_account: 0,
      uncategorized: 0,
      accounts: [],
    });
  });
});
