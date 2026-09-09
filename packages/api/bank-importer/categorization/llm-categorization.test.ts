import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const listMock = vi.hoisted(() => vi.fn());

vi.mock("nuabase", () => ({
  Nua: {
    gateway: vi.fn(() => ({
      list: listMock,
    })),
  },
}));

import {
  categorizeViaLLM,
  buildPrompt,
  buildLLMInput,
  buildLLMRequest,
  parseLLMResponse,
  type LLMCategorizationConfig,
} from "./llm-categorization.js";
import type { Abacus } from "../domain/Abacus.js";

const config: LLMCategorizationConfig = {
  promptTemplate:
    "Categorize using these accounts:\n{hledger_accounts}\nCustom mappings:\n{custom_mapping}",
  hledgerAccounts: "expenses:food\nexpenses:travel",
  customMappings: "STARBUCKS -> expenses:food",
  nuabaseApiKey: "test-key",
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
});

describe("buildPrompt", () => {
  it("substitutes both placeholders", () => {
    expect(buildPrompt(config)).toBe(
      "Categorize using these accounts:\nexpenses:food\nexpenses:travel\n" +
        "Custom mappings:\nSTARBUCKS -> expenses:food",
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
      "Categorize using these accounts:\nexpenses:food\nexpenses:travel\n" +
        "Custom mappings:\nSTARBUCKS -> expenses:food",
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
    expect(req.prompt).toContain("expenses:food"); // prompt still built
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
        { id: "txn-0", account: "expenses:food" },
        { id: "txn-1", account: "expenses:shopping" },
      ],
      reverseMap,
    );
    expect(result).toEqual({
      STARBUCKS: "expenses:food",
      "STARBUCKS DUPLICATE": "expenses:food",
      AMAZON: "expenses:shopping",
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
      [{ id: "txn-unknown", account: "expenses:food" }],
      reverseMap,
    );
    expect(result).toEqual({});
  });

  it("returns an empty map for empty input", () => {
    expect(parseLLMResponse([], reverseMap)).toEqual({});
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

  it("sends every row once with numbers preserved and does not retry unresolved rows", async () => {
    listMock.mockResolvedValueOnce({
      success: true,
      data: [
        { id: "txn-0", account: "expenses:food" },
        { id: "txn-1", account: "" },
      ],
    });

    const txns = [
      withdrawal("STARBUCKS 123"),
      withdrawal("DUMMY NAME/NONP0050505"),
    ];

    const result = await categorizeViaLLM(txns, [0, 1], config);

    expect(result).toEqual({
      "STARBUCKS 123": "expenses:food",
    });
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(listMock.mock.calls[0][1].input).toEqual([
      { id: "txn-0", text: "Expense: STARBUCKS 123" },
      { id: "txn-1", text: "Expense: DUMMY NAME/NONP0050505" },
    ]);
  });

  it("returns all mappings from the single categorization pass", async () => {
    listMock.mockResolvedValueOnce({
      success: true,
      data: [
        { id: "txn-0", account: "expenses:food" },
        { id: "txn-1", account: "expenses:travel" },
      ],
    });

    const txns = [withdrawal("STARBUCKS 123"), withdrawal("UBER 456")];
    const result = await categorizeViaLLM(txns, [0, 1], config);

    expect(result).toEqual({
      "STARBUCKS 123": "expenses:food",
      "UBER 456": "expenses:travel",
    });
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});
