import { describe, expect, it } from "vitest";
import type { Abacus } from "../statement/index.js";
import { moneyFromColumns } from "../values/index.js";
import {
  classifyWith,
  compileMappings,
  mappingRulesSchema,
  normalize,
  type MappingRules,
} from "./mapping-rules.js";

const RULES: MappingRules = {
  exact: {
    "Corner Fuels": "expenses:vehicle",
    "ACME SUPERMARKET": "expenses:grocery",
    "sample-grocer@okaxis": "expenses:grocery",
    "x@psp": "expenses:misc",
  },
  includes: [
    {
      account: "cc:example",
      direction: "withdrawal",
      values: ["CARD PAYMENT TO CARD 4000123412341234"],
    },
    { account: "expenses:fuel", direction: "withdrawal", values: ["FUELS"] },
    {
      account: "income:credit-interest",
      direction: "deposit",
      values: ["INTEREST PAID"],
    },
  ],
};

function transaction(
  narration: string,
  direction: "withdrawal" | "deposit" = "withdrawal",
): Abacus {
  return {
    date: "2026-01-01",
    narration,
    ...moneyFromColumns({
      withdrawal: direction === "withdrawal" ? 100 : 0,
      deposit: direction === "deposit" ? 100 : 0,
    }),
    balance: 0,
  };
}

const classify = (
  narration: string,
  direction: "withdrawal" | "deposit" = "withdrawal",
) => classifyWith(compileMappings(RULES), transaction(narration, direction));

describe("normalize", () => {
  it("folds case and collapses whitespace, preserving identifiers", () => {
    expect(normalize("  card payment  to\tcard 4000 ")).toBe(
      "CARD PAYMENT TO CARD 4000",
    );
  });
});

describe("classifyWith", () => {
  it("prefers an exact mapping over a broader includes mapping", () => {
    expect(classify("Corner Fuels")).toBe("expenses:vehicle");
  });

  it("matches normalized contains rules", () => {
    expect(classify("  card payment to card   4000123412341234  ")).toBe(
      "cc:example",
    );
  });

  it("falls through to the broader includes rule", () => {
    expect(classify("HIGHWAY FUELS PVT LTD")).toBe("expenses:fuel");
  });

  it("honors direction", () => {
    expect(classify("Interest Paid", "deposit")).toBe("income:credit-interest");
    expect(classify("Interest Paid", "withdrawal")).toBeNull();
  });

  it("leaves unknown transactions unmatched", () => {
    expect(classify("Unknown Merchant")).toBeNull();
  });

  it("matches a VPA exact key against the VPA embedded in a bank narration", () => {
    // Federal: slash-delimited. HDFC: hyphen-delimited. GPay enrichment:
    // recipient prefix. All keep the VPA intact between delimiters.
    expect(classify("UPIOUT/050505000001/sample-grocer@okaxis/UPI/0505")).toBe(
      "expenses:grocery",
    );
    expect(
      classify(
        "UPI-SAMPLE GROCER-sample-grocer@okaxis-FDRL0050505-050505000001-sample",
      ),
    ).toBe("expenses:grocery");
    expect(
      classify(
        "Sample Grocer | UPIOUT/050505000001/sample-grocer@okaxis/UPI/0505",
      ),
    ).toBe("expenses:grocery");
    expect(classify("sample-grocer@okaxis")).toBe("expenses:grocery");
  });

  it("requires the embedded VPA to be delimited, not a fragment of a longer one", () => {
    expect(classify("UPIOUT/050505000001/x@psp/UPI/0000")).toBe(
      "expenses:misc",
    );
    expect(classify("UPIOUT/050505000001/ax@psp/UPI/0000")).toBeNull();
    expect(classify("UPIOUT/050505000001/x@psp.example/UPI/0000")).toBeNull();
    expect(classify("UPIOUT/050505000001/x@pspbank/UPI/0000")).toBeNull();
  });

  it("prefers a whole-narration exact match over an embedded VPA match", () => {
    const rules: MappingRules = {
      exact: {
        "UPIOUT/050505000001/x@psp/UPI/0000": "expenses:special",
        "x@psp": "expenses:misc",
      },
      includes: [],
    };
    expect(
      classifyWith(
        compileMappings(rules),
        transaction("UPIOUT/050505000001/x@psp/UPI/0000"),
      ),
    ).toBe("expenses:special");
  });
});

describe("compileMappings", () => {
  it("rejects exact mappings that collide after normalization", () => {
    expect(() =>
      compileMappings({
        exact: {
          "acme supermarket": "expenses:grocery",
          "ACME  SUPERMARKET": "expenses:food",
        },
        includes: [],
      }),
    ).toThrow(/Conflicting exact transaction mapping/);
  });

  it("accepts a collision that agrees on the account", () => {
    expect(() =>
      compileMappings({
        exact: {
          "acme supermarket": "expenses:grocery",
          "ACME  SUPERMARKET": "expenses:grocery",
        },
        includes: [],
      }),
    ).not.toThrow();
  });
});

describe("mappingRulesSchema", () => {
  it("rejects an empty account name", () => {
    expect(
      mappingRulesSchema.safeParse({ exact: { FOO: "  " }, includes: [] })
        .success,
    ).toBe(false);
  });

  it("rejects an includes rule with no values", () => {
    expect(
      mappingRulesSchema.safeParse({
        exact: {},
        includes: [{ account: "expenses:food", values: [] }],
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown direction", () => {
    expect(
      mappingRulesSchema.safeParse({
        exact: {},
        includes: [
          { account: "expenses:food", direction: "refund", values: ["X"] },
        ],
      }).success,
    ).toBe(false);
  });
});
