import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  categorizeViaLLM,
  buildPrompt,
  buildLLMInput,
  buildLLMRequest,
  parseLLMResponse,
  splitIntoCalls,
  type CategorizationLlm,
  type LLMCategorizationConfig,
} from "./llm-categorization.js";
import type { Abacus } from "../statement/index.js";

const listMock = vi.fn();
// Whether the engine can be used, asked after a failed call; it answers by
// default.
const confirmUnavailableMock = vi.fn(async (): Promise<string | null> => null);

function engine(overrides: Partial<CategorizationLlm> = {}): CategorizationLlm {
  return {
    agent: "claude-code",
    name: "Claude Code",
    caller: {
      ready: true,
      client: { list: listMock },
      maxRowsPerCall: null,
      confirmUnavailable: confirmUnavailableMock,
    },
    ...overrides,
  };
}

// A coding agent takes at most 50 descriptions a call.
const batchedCaller = {
  ready: true as const,
  client: { list: listMock },
  maxRowsPerCall: 50,
  confirmUnavailable: confirmUnavailableMock,
};

const config: LLMCategorizationConfig = {
  promptTemplate:
    "Categorize using these accounts:\n{accounts}\nCustom mappings:\n{custom_mapping}",
  accounts: "Food\nTravel",
  customMappings: "STARBUCKS -> Food",
  llm: engine(),
};

function withdrawal(narration: string, amount = 100): Abacus {
  return {
    date: "2026-01-01",
    narration,
    withdrawal: amount,
    deposit: 0,
    balance: 0,
  };
}
function deposit(narration: string, amount = 100): Abacus {
  return {
    date: "2026-01-01",
    narration,
    withdrawal: 0,
    deposit: amount,
    balance: 0,
  };
}

beforeEach(() => {
  listMock.mockReset();
  confirmUnavailableMock.mockReset();
  confirmUnavailableMock.mockResolvedValue(null);
});

describe("buildPrompt", () => {
  it("substitutes both placeholders", () => {
    expect(buildPrompt(config)).toBe(
      "Categorize using these accounts:\nFood\nTravel\n" +
        "Custom mappings:\nSTARBUCKS -> Food",
    );
  });

  it("leaves the template unchanged when no placeholders are present", () => {
    expect(
      buildPrompt({ ...config, promptTemplate: "no placeholders here" }),
    ).toBe("no placeholders here");
  });
});

describe("buildLLMInput", () => {
  it("returns empty rows/reverseMap when no indices given", () => {
    expect(buildLLMInput([withdrawal("X")], [])).toEqual({
      rows: [],
      reverseMap: {},
    });
  });

  it("prefixes withdrawals with 'Expense: ' and deposits with 'Deposit: '", () => {
    const txns = [withdrawal("STARBUCKS"), deposit("SALARY ACME")];
    const { rows } = buildLLMInput(txns, [0, 1]);
    expect(rows).toEqual([
      { id: "txn-0", text: "Expense: STARBUCKS" },
      { id: "txn-1", text: "Deposit: SALARY ACME" },
    ]);
  });

  it("dedupes rows with identical prefixed text and tracks all narrations in the reverse map", () => {
    const txns = [
      withdrawal("STARBUCKS"),
      withdrawal("STARBUCKS"),
      withdrawal("AMAZON"),
    ];
    const { rows, reverseMap } = buildLLMInput(txns, [0, 1, 2]);
    expect(rows).toEqual([
      { id: "txn-0", text: "Expense: STARBUCKS" },
      { id: "txn-1", text: "Expense: AMAZON" },
    ]);
    expect(reverseMap).toEqual({
      "txn-0": ["STARBUCKS", "STARBUCKS"],
      "txn-1": ["AMAZON"],
    });
  });

  it("treats the same narration with different prefixes as distinct rows", () => {
    const txns = [withdrawal("REFUND"), deposit("REFUND")];
    const { rows, reverseMap } = buildLLMInput(txns, [0, 1]);
    expect(rows).toEqual([
      { id: "txn-0", text: "Expense: REFUND" },
      { id: "txn-1", text: "Deposit: REFUND" },
    ]);
    expect(reverseMap).toEqual({
      "txn-0": ["REFUND"],
      "txn-1": ["REFUND"],
    });
  });

  it("preserves the full narration, including numbers, in the text sent to LLM", () => {
    const txns = [
      withdrawal("IMPS-050505000001-JOHN DOE-SCBL-XXXXXXX0505-TO MY STANC"),
    ];
    const { rows, reverseMap } = buildLLMInput(txns, [0]);
    expect(rows[0].text).toBe(
      "Expense: IMPS-050505000001-JOHN DOE-SCBL-XXXXXXX0505-TO MY STANC",
    );
    expect(reverseMap["txn-0"]).toEqual([
      "IMPS-050505000001-JOHN DOE-SCBL-XXXXXXX0505-TO MY STANC",
    ]);
  });

  it("only processes the indices passed in", () => {
    const txns = [withdrawal("A"), withdrawal("B"), withdrawal("C")];
    const { rows } = buildLLMInput(txns, [0, 2]);
    expect(rows.map((r) => r.text)).toEqual(["Expense: A", "Expense: C"]);
  });
});

describe("buildLLMRequest", () => {
  // This is the full I/O boundary: everything sent to nua.list().
  it("assembles prompt + rows + reverseMap and matches what would be sent to Nua", () => {
    const txns = [withdrawal("STARBUCKS"), deposit("SALARY")];
    const req = buildLLMRequest(txns, [0, 1], config);

    expect(req.prompt).toBe(
      "Categorize using these accounts:\nFood\nTravel\n" +
        "Custom mappings:\nSTARBUCKS -> Food",
    );
    expect(req.rows).toEqual([
      { id: "txn-0", text: "Expense: STARBUCKS" },
      { id: "txn-1", text: "Deposit: SALARY" },
    ]);
    expect(req.reverseMap).toEqual({
      "txn-0": ["STARBUCKS"],
      "txn-1": ["SALARY"],
    });
  });

  it("returns empty rows for an empty index list (shell will short-circuit before calling Nua)", () => {
    const req = buildLLMRequest([withdrawal("X")], [], config);
    expect(req.rows).toEqual([]);
    expect(req.reverseMap).toEqual({});
    expect(req.prompt).toContain("Food"); // prompt still built
  });
});

describe("parseLLMResponse", () => {
  const reverseMap = {
    "txn-0": ["STARBUCKS", "STARBUCKS DUPLICATE"],
    "txn-1": ["AMAZON"],
  };

  it("maps every original narration for a row to its account", () => {
    const result = parseLLMResponse(
      [
        { id: "txn-0", account: "Food" },
        { id: "txn-1", account: "Shopping" },
      ],
      reverseMap,
    );
    expect(result).toEqual({
      STARBUCKS: "Food",
      "STARBUCKS DUPLICATE": "Food",
      AMAZON: "Shopping",
    });
  });

  it("skips rows with empty or whitespace-only accounts", () => {
    const result = parseLLMResponse(
      [
        { id: "txn-0", account: "" },
        { id: "txn-1", account: "   " },
      ],
      reverseMap,
    );
    expect(result).toEqual({});
  });

  it("skips rows whose id is not in the reverse map", () => {
    const result = parseLLMResponse(
      [{ id: "txn-unknown", account: "Food" }],
      reverseMap,
    );
    expect(result).toEqual({});
  });

  it("returns an empty map for empty input", () => {
    expect(parseLLMResponse([], reverseMap)).toEqual({});
  });
});

describe("splitIntoCalls", () => {
  it("sends every row in one call when there is no limit", () => {
    expect(splitIntoCalls([1, 2, 3], null)).toEqual([[1, 2, 3]]);
  });

  it("splits 120 rows into calls of 50, 50 and 20, in order", () => {
    const rows = Array.from({ length: 120 }, (_, i) => i);
    const calls = splitIntoCalls(rows, 50);
    expect(calls.map((call) => call.length)).toEqual([50, 50, 20]);
    expect(calls.flat()).toEqual(rows);
  });
});

describe("categorizeViaLLM", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Answers each row of a call with an account named after its text:
  // "SHOP119" is "Account SHOP119".
  function answerEveryRow() {
    listMock.mockImplementation(
      async (request: { rows: { id: string; text: string }[] }) => ({
        ok: true,
        rows: request.rows.map((row) => ({
          id: row.id,
          account: `Account ${row.text.slice("Expense: ".length)}`,
        })),
      }),
    );
  }

  it("sends every row once with numbers preserved and does not retry unresolved rows", async () => {
    listMock.mockResolvedValueOnce({
      ok: true,
      rows: [
        { id: "txn-0", account: "Food" },
        { id: "txn-1", account: "" },
      ],
    });

    const txns = [
      withdrawal("STARBUCKS 123"),
      withdrawal("DUMMY NAME/NONP0050505"),
    ];

    const result = await categorizeViaLLM(txns, [0, 1], config);

    expect(result.mappings).toEqual({
      "STARBUCKS 123": "Food",
    });
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(listMock.mock.calls[0][0].rows).toEqual([
      { id: "txn-0", text: "Expense: STARBUCKS 123" },
      { id: "txn-1", text: "Expense: DUMMY NAME/NONP0050505" },
    ]);
    expect(listMock.mock.calls[0][0].output.name).toBe("account");
  });

  it("reports every distinct description sent, and none failed, when the call succeeds", async () => {
    listMock.mockResolvedValueOnce({
      ok: true,
      rows: [
        { id: "txn-0", account: "Food" },
        { id: "txn-1", account: "Travel" },
      ],
    });

    const txns = [
      withdrawal("STARBUCKS 123"),
      withdrawal("STARBUCKS 123"),
      withdrawal("UBER 456"),
    ];
    const result = await categorizeViaLLM(txns, [0, 1, 2], config);

    expect(result).toEqual({
      mappings: {
        "STARBUCKS 123": "Food",
        "UBER 456": "Travel",
      },
      report: {
        agent: "claude-code",
        sent_count: 2,
        failed_count: 0,
        error: null,
        failure: null,
      },
    });
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("reports nothing sent when no transaction needs the LLM", async () => {
    const result = await categorizeViaLLM([withdrawal("X")], [], config);

    expect(result).toEqual({
      mappings: {},
      report: {
        agent: "claude-code",
        sent_count: 0,
        failed_count: 0,
        error: null,
        failure: null,
      },
    });
    expect(listMock).not.toHaveBeenCalled();
  });

  it("reports every description failed, without a call, when the engine can't run", async () => {
    const result = await categorizeViaLLM(
      [withdrawal("A"), withdrawal("B")],
      [0, 1],
      {
        ...config,
        llm: engine({
          caller: { ready: false, reason: "NUABASE_API_KEY is not set" },
        }),
      },
    );

    expect(result).toEqual({
      mappings: {},
      report: {
        agent: "claude-code",
        sent_count: 2,
        failed_count: 2,
        error: "NUABASE_API_KEY is not set",
        failure: "agent_unavailable",
      },
    });
    expect(listMock).not.toHaveBeenCalled();
  });

  it("reports a failed call instead of throwing", async () => {
    listMock.mockResolvedValueOnce({ ok: false, error: "sample failure" });

    const failed = await categorizeViaLLM([withdrawal("A")], [0], config);

    expect(failed.mappings).toEqual({});
    expect(failed.report).toEqual({
      agent: "claude-code",
      sent_count: 1,
      failed_count: 1,
      error: "sample failure",
      failure: "partial",
    });
  });

  it("splits a local agent's descriptions into calls of 50 and merges the answers", async () => {
    answerEveryRow();
    const txns = Array.from({ length: 120 }, (_, i) => withdrawal(`SHOP${i}`));

    const result = await categorizeViaLLM(
      txns,
      txns.map((_, i) => i),
      { ...config, llm: engine({ caller: batchedCaller }) },
    );

    expect(listMock.mock.calls.map((call) => call[0].rows.length)).toEqual([
      50, 50, 20,
    ]);
    expect(Object.keys(result.mappings)).toHaveLength(120);
    expect(result.mappings.SHOP119).toBe("Account SHOP119");
    expect(result.report).toEqual({
      agent: "claude-code",
      sent_count: 120,
      failed_count: 0,
      error: null,
      failure: null,
    });
  });

  it("counts only a failed call's own descriptions and keeps the other calls' answers", async () => {
    answerEveryRow();
    listMock.mockImplementationOnce(
      async (request: { rows: { id: string }[] }) => ({
        ok: true,
        rows: request.rows.map((row) => ({
          id: row.id,
          account: "First Expense",
        })),
      }),
    );
    listMock.mockImplementationOnce(async () => ({
      ok: false,
      error: "claude-code timed out",
    }));
    const txns = Array.from({ length: 120 }, (_, i) => withdrawal(`SHOP${i}`));

    const result = await categorizeViaLLM(
      txns,
      txns.map((_, i) => i),
      { ...config, llm: engine({ caller: batchedCaller }) },
    );

    expect(result.report).toEqual({
      agent: "claude-code",
      sent_count: 120,
      failed_count: 50,
      error: "claude-code timed out",
      failure: "partial",
    });
    expect(result.mappings.SHOP0).toBe("First Expense");
    expect(result.mappings.SHOP50).toBeUndefined();
    expect(result.mappings.SHOP100).toBe("Account SHOP100");
    expect(Object.keys(result.mappings)).toHaveLength(70);
    expect(confirmUnavailableMock).not.toHaveBeenCalled();
  });

  it("sends no other call once the first fails and the engine can't be used", async () => {
    listMock.mockResolvedValueOnce({ ok: false, error: "Not logged in" });
    confirmUnavailableMock.mockResolvedValueOnce(
      "Claude Code didn't answer on Claude Sonnet. See Settings.",
    );
    const txns = Array.from({ length: 120 }, (_, i) => withdrawal(`SHOP${i}`));

    const result = await categorizeViaLLM(
      txns,
      txns.map((_, i) => i),
      { ...config, llm: engine({ caller: batchedCaller }) },
    );

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(confirmUnavailableMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      mappings: {},
      report: {
        agent: "claude-code",
        sent_count: 120,
        failed_count: 120,
        error: "Claude Code didn't answer on Claude Sonnet. See Settings.",
        failure: "agent_unavailable",
      },
    });
  });

  it("sends the other calls when the first fails but the engine still answers", async () => {
    answerEveryRow();
    listMock.mockImplementationOnce(async () => ({
      ok: false,
      error: "claude-code timed out",
    }));
    const txns = Array.from({ length: 120 }, (_, i) => withdrawal(`SHOP${i}`));

    const result = await categorizeViaLLM(
      txns,
      txns.map((_, i) => i),
      { ...config, llm: engine({ caller: batchedCaller }) },
    );

    expect(listMock).toHaveBeenCalledTimes(3);
    expect(confirmUnavailableMock).toHaveBeenCalledTimes(1);
    expect(result.report).toEqual({
      agent: "claude-code",
      sent_count: 120,
      failed_count: 50,
      error: "claude-code timed out",
      failure: "partial",
    });
    expect(Object.keys(result.mappings)).toHaveLength(70);
  });
});
