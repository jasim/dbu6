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
    "Corner Fuels": "Vehicle",
    "ACME SUPERMARKET": "Groceries",
    "sample-grocer@okaxis": "Groceries",
    "x@psp": "Miscellaneous",
  },
  includes: [
    {
      account: "Example Credit Card",
      direction: "withdrawal",
      values: ["CARD PAYMENT TO CARD 0505054000120000"],
    },
    { account: "Fuel", direction: "withdrawal", values: ["FUELS"] },
    {
      account: "Credit Interest",
      direction: "deposit",
      values: ["INTEREST PAID"],
    },
  ],
};

function transaction(
  narration: string,
  direction: "withdrawal" | "deposit" = "withdrawal",
  amount = 100,
): Abacus {
  return {
    date: "2026-01-01",
    narration,
    ...moneyFromColumns({
      withdrawal: direction === "withdrawal" ? amount : 0,
      deposit: direction === "deposit" ? amount : 0,
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
    expect(classify("Corner Fuels")).toBe("Vehicle");
  });

  it("matches normalized contains rules", () => {
    expect(classify("  card payment to card   0505054000120000  ")).toBe(
      "Example Credit Card",
    );
  });

  it("falls through to the broader includes rule", () => {
    expect(classify("HIGHWAY FUELS PVT LTD")).toBe("Fuel");
  });

  it("honors direction", () => {
    expect(classify("Interest Paid", "deposit")).toBe("Credit Interest");
    expect(classify("Interest Paid", "withdrawal")).toBeNull();
  });

  it("applies a contains rule only to amounts in its range, both ends included", () => {
    const compiled = compileMappings({
      exact: {},
      includes: [
        {
          account: "Auto rickshaw",
          direction: "withdrawal",
          amount: { min: 20, max: 500 },
          values: ["UPIOUT"],
        },
        { account: "Big UPI", amount: { min: 5000 }, values: ["UPIOUT"] },
      ],
    });
    const at = (
      amount: number,
      direction: "withdrawal" | "deposit" = "withdrawal",
    ) =>
      classifyWith(
        compiled,
        transaction("UPIOUT/050505000001", direction, amount),
      );
    expect(at(20)).toBe("Auto rickshaw");
    expect(at(500)).toBe("Auto rickshaw");
    expect(at(10)).toBeNull();
    expect(at(1000)).toBeNull();
    expect(at(5000)).toBe("Big UPI");
    // The range is of the amount moved, either way.
    expect(at(6000, "deposit")).toBe("Big UPI");
    expect(at(300, "deposit")).toBeNull();
  });

  it("leaves unknown transactions unmatched", () => {
    expect(classify("Unknown Merchant")).toBeNull();
  });

  it("matches a VPA exact key against the VPA embedded in a bank narration", () => {
    // Federal: slash-delimited. HDFC: hyphen-delimited. GPay enrichment:
    // recipient prefix. All keep the VPA intact between delimiters.
    expect(classify("UPIOUT/050505000001/sample-grocer@okaxis/UPI/0505")).toBe(
      "Groceries",
    );
    expect(
      classify(
        "UPI-SAMPLE GROCER-sample-grocer@okaxis-FDRL0050505-050505000001-sample",
      ),
    ).toBe("Groceries");
    expect(
      classify(
        "Sample Grocer | UPIOUT/050505000001/sample-grocer@okaxis/UPI/0505",
      ),
    ).toBe("Groceries");
    expect(classify("sample-grocer@okaxis")).toBe("Groceries");
  });

  it("requires the embedded VPA to be delimited, not a fragment of a longer one", () => {
    expect(classify("UPIOUT/050505000001/x@psp/UPI/0000")).toBe(
      "Miscellaneous",
    );
    expect(classify("UPIOUT/050505000001/ax@psp/UPI/0000")).toBeNull();
    expect(classify("UPIOUT/050505000001/x@psp.example/UPI/0000")).toBeNull();
    expect(classify("UPIOUT/050505000001/x@pspbank/UPI/0000")).toBeNull();
  });

  it("prefers a whole-narration exact match over an embedded VPA match", () => {
    const rules: MappingRules = {
      exact: {
        "UPIOUT/050505000001/x@psp/UPI/0000": "Special",
        "x@psp": "Miscellaneous",
      },
      includes: [],
    };
    expect(
      classifyWith(
        compileMappings(rules),
        transaction("UPIOUT/050505000001/x@psp/UPI/0000"),
      ),
    ).toBe("Special");
  });
});

describe("compileMappings", () => {
  it("rejects exact mappings that collide after normalization", () => {
    expect(() =>
      compileMappings({
        exact: {
          "acme supermarket": "Groceries",
          "ACME  SUPERMARKET": "Food",
        },
        includes: [],
      }),
    ).toThrow(/Conflicting exact transaction mapping/);
  });

  it("accepts a collision that agrees on the account", () => {
    expect(() =>
      compileMappings({
        exact: {
          "acme supermarket": "Groceries",
          "ACME  SUPERMARKET": "Groceries",
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
        includes: [{ account: "Food", values: [] }],
      }).success,
    ).toBe(false);
  });

  it("rejects an amount range with no end, or with its ends reversed", () => {
    const withAmount = (amount: unknown) =>
      mappingRulesSchema.safeParse({
        exact: {},
        includes: [{ account: "Food", amount, values: ["X"] }],
      }).success;
    expect(withAmount({ max: 500 })).toBe(true);
    expect(withAmount({ min: 100, max: 100 })).toBe(true);
    expect(withAmount({})).toBe(false);
    expect(withAmount({ min: 500, max: 100 })).toBe(false);
    expect(withAmount({ min: -1 })).toBe(false);
    expect(withAmount({ below: 500 })).toBe(false);
  });

  it("rejects an unknown direction", () => {
    expect(
      mappingRulesSchema.safeParse({
        exact: {},
        includes: [{ account: "Food", direction: "refund", values: ["X"] }],
      }).success,
    ).toBe(false);
  });
});
