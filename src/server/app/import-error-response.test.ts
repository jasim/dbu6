import { describe, expect, it } from "vitest";
import {
  statementImportErrorSchema,
  type StatementImportErrorCode,
} from "../../shared/index.js";
import { CategorizationConfigError } from "../modules/categorization/index.js";
import { AssertionConflictError } from "../modules/drafts/index.js";
import {
  AmbiguousDuplicateError,
  ReconciliationMatchError,
} from "../modules/reconciliation/index.js";
import {
  AbacusJsonParseError,
  BalanceMismatchError,
  ClosingBalanceUnavailable,
  OpeningBalanceUnavailable,
  SegmentBalanceMismatchError,
  StatementBoundaryMismatchError,
  StatementDisagreementError,
  StatementPartInvalidError,
  StatementPartUnjoinableError,
} from "../modules/statement/index.js";
import {
  AccountNotFoundError,
  type ImportRefusal,
} from "../workflows/statement-import/index.js";
import {
  categorizationErrorResponse,
  importErrorResponse,
  respondWithImportErrors,
} from "./import-error-response.js";

// Each refusal's status and body. Every body must also parse as the contract's
// variant for its code, which is what the Import screen and agents read.
function translate(err: ImportRefusal) {
  const response = importErrorResponse(err);
  expect(statementImportErrorSchema.parse(response.body)).toEqual(
    response.body,
  );
  return response;
}

const cases: Array<{
  code: StatementImportErrorCode;
  error: ImportRefusal;
  status: 400 | 422;
  body: Record<string, unknown>;
}> = [
  {
    code: "import_account_not_found",
    error: new AccountNotFoundError("Sample Bank"),
    status: 422,
    body: {
      message: "The ledger has no account named Sample Bank.",
      hint: expect.stringMatching(/Accounts/),
    },
  },
  {
    code: "reconciliation_match_failed",
    error: new ReconciliationMatchError("no row lands on the checkpoint", {
      date: "2026-01-31",
      balance: 5000,
    }),
    status: 422,
    body: {
      message: "no row lands on the checkpoint",
      checkpoint_date: "2026-01-31",
      checkpoint_balance: 5000,
    },
  },
  {
    code: "balance_mismatch",
    error: new BalanceMismatchError(3500, 4000, 1),
    status: 422,
    body: {
      computed_final: 3500,
      statement_closing: 4000,
      difference: 500,
      tolerance: 1,
      suspected_gap: false,
    },
  },
  {
    code: "segment_balance_mismatch",
    error: new SegmentBalanceMismatchError(
      { date: "2026-01-01", balance: 1000 },
      { date: "2026-01-05" },
      1500,
      2000,
      1,
    ),
    status: 422,
    body: {
      from_date: "2026-01-01",
      to_date: "2026-01-05",
      from_balance: 1000,
      walked: 1500,
      printed: 2000,
      difference: 500,
      tolerance: 1,
    },
  },
  {
    code: "opening_balance_unavailable",
    error: new OpeningBalanceUnavailable(),
    status: 400,
    body: {},
  },
  {
    code: "closing_balance_unavailable",
    error: new ClosingBalanceUnavailable(),
    status: 400,
    body: {},
  },
  {
    code: "statement_boundary_mismatch",
    error: new StatementBoundaryMismatchError(
      1000,
      1200,
      "sample-jan.csv",
      "sample-mar.csv",
    ),
    status: 422,
    body: {
      reason: "gap",
      earlier_source: "sample-jan.csv",
      later_source: "sample-mar.csv",
      earlier_closing: 1000,
      later_opening: 1200,
      difference: 200,
    },
  },
  {
    code: "statement_disagreement",
    error: new StatementDisagreementError(
      ["sample-a.csv", "sample-b.csv"],
      "2026-01-18",
      {
        part: "sample-b.csv",
        narration: "NOPII SAMPLE PAYEE",
        withdrawal: 300,
        deposit: 0,
        balance: null,
      },
    ),
    status: 422,
    body: {
      parts: ["sample-a.csv", "sample-b.csv"],
      date: "2026-01-18",
      row: {
        part: "sample-b.csv",
        narration: "NOPII SAMPLE PAYEE",
        withdrawal: 300,
        deposit: 0,
        balance: null,
      },
    },
  },
  {
    code: "statement_part_unjoinable",
    error: new StatementPartUnjoinableError("sample-page-2.pdf"),
    status: 422,
    body: { part: "sample-page-2.pdf" },
  },
  {
    code: "statement_part_invalid",
    error: new StatementPartInvalidError(
      "sample-feb.csv",
      "its declared opening does not match its first row",
    ),
    status: 422,
    body: {
      part: "sample-feb.csv",
      detail: "its declared opening does not match its first row",
    },
  },
  {
    code: "ambiguous_duplicate",
    error: new AmbiguousDuplicateError("sample-key-050505", [
      "draft:1",
      "journal:2:entry:3",
    ]),
    status: 422,
    body: {
      source_transaction_key: "sample-key-050505",
      candidate_ids: ["draft:1", "journal:2:entry:3"],
    },
  },
  {
    code: "assertion_conflict",
    error: new AssertionConflictError("2026-01-31", 5000, 6000),
    status: 422,
    body: {
      date: "2026-01-31",
      existing_assertion: 5000,
      expected_assertion: 6000,
    },
  },
  {
    code: "abacus_json_parse_failed",
    error: new AbacusJsonParseError("invalid JSON: sample"),
    status: 400,
    body: {
      message: "Could not parse the uploaded JSON as abacus rows.",
      detail: "invalid JSON: sample",
    },
  },
  {
    code: "categorization_config_error",
    error: new CategorizationConfigError(
      "Missing required categorization config file: sample.mjs.",
    ),
    status: 400,
    body: {
      message: "Missing required categorization config file: sample.mjs.",
    },
  },
];

describe("importErrorResponse", () => {
  it("covers every error code the contract declares", () => {
    const codes = statementImportErrorSchema.options.map(
      (variant) => variant.shape.error.value,
    );
    expect(cases.map((one) => one.code).sort()).toEqual([...codes].sort());
  });

  it.each(cases)(
    "translates $code to its status and body",
    ({ code, error, status, body }) => {
      const response = translate(error);
      expect(response.status).toBe(status);
      expect(response.body).toMatchObject({
        error: code,
        message: error.message,
        ...body,
      });
    },
  );

  it("adds no hint when a closing drift has no suspected gap", () => {
    const { body } = translate(new BalanceMismatchError(3500, 4000, 1));
    expect(body).not.toHaveProperty("hint");
  });

  it("hints at a missing period when a gap is suspected", () => {
    const { body } = translate(new BalanceMismatchError(3500, 4000, 1, true));
    expect(body).toMatchObject({
      suspected_gap: true,
      hint: expect.stringMatching(/no gaps/),
    });
  });

  it("adds no hint to a boundary gap", () => {
    const { body } = translate(
      new StatementBoundaryMismatchError(1000, 1200, "sample-a", "sample-b"),
    );
    expect(body).not.toHaveProperty("hint");
  });

  it("hints that the same statement was uploaded twice, naming both parts", () => {
    const { body } = translate(
      new StatementBoundaryMismatchError(
        1000,
        1000,
        "sample-jul.csv",
        "sample-jul.xls",
        "same-statement-twice",
      ),
    );
    expect(body).toMatchObject({
      reason: "same-statement-twice",
      hint: expect.stringMatching(
        /sample-jul\.xls .* sample-jul\.csv .*same statement uploaded twice/,
      ),
    });
  });

  it("gives an invalid part's reused balance error as its cause", () => {
    const cause = new BalanceMismatchError(500, 900, 1);
    const { body } = translate(
      new StatementPartInvalidError("sample-feb.csv", cause.message, cause),
    );
    expect(body).toMatchObject({
      error: "statement_part_invalid",
      cause: {
        error: "balance_mismatch",
        message: cause.message,
        computed_final: 500,
        statement_closing: 900,
      },
    });
  });
});

describe("categorizationErrorResponse", () => {
  it("is the classify routes' 400", () => {
    const error = new CategorizationConfigError("sample config missing");
    expect(categorizationErrorResponse(error)).toEqual({
      status: 400,
      body: {
        error: "categorization_config_error",
        message: "sample config missing",
      },
    });
  });
});

describe("respondWithImportErrors", () => {
  it("answers a refusal with its status and body", async () => {
    const response = await respondWithImportErrors(async () => {
      throw new OpeningBalanceUnavailable();
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: "opening_balance_unavailable",
    });
  });

  it("lets any other error through as a fault", async () => {
    const fault = new Error("sample fault");
    await expect(
      respondWithImportErrors(async () => {
        throw fault;
      }),
    ).rejects.toBe(fault);
  });
});
