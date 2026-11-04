import { describe, expect, it } from "vitest";
import type { Abacus } from "../statement/index.js";
import { moneyFromColumns } from "../values/index.js";
import {
  mappingRulesSchema,
  type MappingRules,
  type MappingRulesFile,
} from "../../../shared/index.js";
import { classifyWith, compileMappings, normalize } from "./mapping-rules.js";

const parse = (rules: MappingRulesFile): MappingRules =>
  mappingRulesSchema.parse(rules);

// The accounts in the books the rules are compiled against.
const BOOKS: ReadonlySet<string> = new Set([
  "Sample savings",
  "Other savings",
  "Sample card",
  "Other",
]);

const RULES = parse({
  exact: [
    {
      statement: "*",
      money: "either",
      narrations: ["Corner Fuels"],
      mapToAccount: "Vehicle",
    },
    {
      statement: "*",
      money: "out",
      narrations: ["ACME SUPERMARKET", "sample-grocer@okaxis"],
      mapToAccount: "Groceries",
    },
    {
      statement: "*",
      money: "either",
      narrations: ["x@psp"],
      mapToAccount: "Miscellaneous",
    },
  ],
  contains: [
    {
      statement: "Sample savings",
      money: "out",
      contains: ["CARD PAYMENT TO CARD 0505054000120000"],
      mapToAccount: "Sample card",
    },
    {
      statement: "*",
      money: "out",
      contains: ["FUELS"],
      mapToAccount: "Fuel",
    },
    {
      statement: ["Sample savings", "Other savings"],
      money: "in",
      contains: ["INTEREST PAID"],
      mapToAccount: "Credit Interest",
    },
  ],
});

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

function classify(
  narration: string,
  direction: "withdrawal" | "deposit" = "withdrawal",
  statementAccount: string | null = "Sample savings",
  rules: MappingRules = RULES,
  amount = 100,
) {
  return classifyWith(compileMappings(rules, BOOKS), {
    transaction: transaction(narration, direction, amount),
    statementAccount,
  });
}

describe("normalize", () => {
  it("folds case and collapses whitespace, preserving identifiers", () => {
    expect(normalize("  card payment  to\tcard 4000 ")).toBe(
      "CARD PAYMENT TO CARD 4000",
    );
  });
});

describe("classifyWith", () => {
  it("prefers an exact rule over a broader contains rule", () => {
    expect(classify("Corner Fuels")).toBe("Vehicle");
  });

  it("matches normalized contains rules", () => {
    expect(classify("  card payment to card   0505054000120000  ")).toBe(
      "Sample card",
    );
  });

  it("falls through to the broader contains rule", () => {
    expect(classify("HIGHWAY FUELS PVT LTD")).toBe("Fuel");
  });

  describe("statement scope", () => {
    it("reads only the statement a rule names", () => {
      expect(classify("CARD PAYMENT TO CARD 0505054000120000")).toBe(
        "Sample card",
      );
      expect(
        classify(
          "CARD PAYMENT TO CARD 0505054000120000",
          "withdrawal",
          "Other savings",
        ),
      ).toBeNull();
    });

    it("reads each statement of a list", () => {
      expect(classify("INTEREST PAID", "deposit", "Sample savings")).toBe(
        "Credit Interest",
      );
      expect(classify("INTEREST PAID", "deposit", "Other savings")).toBe(
        "Credit Interest",
      );
      expect(classify("INTEREST PAID", "deposit", "Sample card")).toBeNull();
    });

    it('reads every statement for "*"', () => {
      expect(classify("Corner Fuels", "withdrawal", "Sample card")).toBe(
        "Vehicle",
      );
    });

    it('meets a row with no statement account only with "*" rules', () => {
      expect(classify("Corner Fuels", "withdrawal", null)).toBe("Vehicle");
      expect(
        classify("CARD PAYMENT TO CARD 0505054000120000", "withdrawal", null),
      ).toBeNull();
      expect(classify("INTEREST PAID", "deposit", null)).toBeNull();
    });
  });

  describe("money", () => {
    it("is out on a withdrawal and in on a deposit", () => {
      expect(classify("Interest Paid", "deposit")).toBe("Credit Interest");
      expect(classify("Interest Paid", "withdrawal")).toBeNull();
      expect(classify("ACME SUPERMARKET", "withdrawal")).toBe("Groceries");
      expect(classify("ACME SUPERMARKET", "deposit")).toBeNull();
    });

    it('matches both ways for "either"', () => {
      expect(classify("Corner Fuels", "withdrawal")).toBe("Vehicle");
      expect(classify("Corner Fuels", "deposit")).toBe("Vehicle");
    });
  });

  it('skips a "*" rule on its own account\'s statement, so a later rule matches', () => {
    const rules = parse({
      exact: [
        {
          statement: "*",
          money: "either",
          narrations: ["BILLPAY SAMPLE CARD"],
          mapToAccount: "Sample card",
        },
      ],
      contains: [
        {
          statement: "*",
          money: "either",
          contains: ["BILLPAY"],
          mapToAccount: "Sample card",
        },
        {
          statement: "Sample card",
          money: "in",
          contains: ["BILLPAY"],
          mapToAccount: "Sample savings",
        },
      ],
    });
    expect(
      classify("BILLPAY SAMPLE CARD", "withdrawal", "Sample savings", rules),
    ).toBe("Sample card");
    expect(
      classify("BILLPAY SAMPLE CARD", "deposit", "Sample card", rules),
    ).toBe("Sample savings");
    expect(
      classify("BILLPAY SAMPLE CARD", "withdrawal", "Sample card", rules),
    ).toBeNull();
  });

  it("applies a contains rule only to amounts in its range, both ends included", () => {
    const rules = parse({
      exact: [],
      contains: [
        {
          statement: "*",
          money: "out",
          amount: { min: 20, max: 500 },
          contains: ["UPIOUT"],
          mapToAccount: "Auto rickshaw",
        },
        {
          statement: "*",
          money: "either",
          amount: { min: 5000 },
          contains: ["UPIOUT"],
          mapToAccount: "Big UPI",
        },
      ],
    });
    const at = (
      amount: number,
      direction: "withdrawal" | "deposit" = "withdrawal",
    ) =>
      classify(
        "UPIOUT/050505000001",
        direction,
        "Sample savings",
        rules,
        amount,
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

  it("matches a VPA exact text against the VPA embedded in a bank narration", () => {
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

  it("matches an embedded VPA only on the statements and money its rule names", () => {
    const rules = parse({
      exact: [
        {
          statement: "Sample savings",
          money: "out",
          narrations: ["sample-payee@psp"],
          mapToAccount: "Rent",
        },
      ],
      contains: [],
    });
    const narration = "UPIOUT/050505000001/sample-payee@psp/UPI/0505";
    expect(classify(narration, "withdrawal", "Sample savings", rules)).toBe(
      "Rent",
    );
    expect(
      classify(narration, "withdrawal", "Other savings", rules),
    ).toBeNull();
    expect(classify(narration, "deposit", "Sample savings", rules)).toBeNull();
  });

  it("requires the embedded VPA to be delimited, not a fragment of a longer one", () => {
    expect(classify("UPIOUT/050505000001/x@psp/UPI/0000")).toBe(
      "Miscellaneous",
    );
    expect(classify("UPIOUT/050505000001/ax@psp/UPI/0000")).toBeNull();
    expect(classify("UPIOUT/050505000001/x@psp.example/UPI/0000")).toBeNull();
    expect(classify("UPIOUT/050505000001/x@pspbank/UPI/0000")).toBeNull();
  });

  it("checks exact texts, then VPAs, then contains rules, whatever the file order", () => {
    const rules = parse({
      exact: [
        {
          statement: "*",
          money: "either",
          narrations: ["x@psp"],
          mapToAccount: "By VPA",
        },
        {
          statement: "*",
          money: "either",
          narrations: ["UPIOUT/050505000001/x@psp/UPI/0000"],
          mapToAccount: "By whole narration",
        },
      ],
      contains: [
        {
          statement: "*",
          money: "either",
          contains: ["UPIOUT"],
          mapToAccount: "By contains",
        },
      ],
    });
    expect(
      classify(
        "UPIOUT/050505000001/x@psp/UPI/0000",
        "withdrawal",
        "Sample savings",
        rules,
      ),
    ).toBe("By whole narration");
    expect(
      classify(
        "UPIOUT/050505000002/x@psp/UPI/0000",
        "withdrawal",
        "Sample savings",
        rules,
      ),
    ).toBe("By VPA");
    expect(
      classify(
        "UPIOUT/050505000002/y@psp/UPI/0000",
        "withdrawal",
        "Sample savings",
        rules,
      ),
    ).toBe("By contains");
  });

  it("answers the same text by statement, when two exact rules don't overlap", () => {
    const rules = parse({
      exact: [
        {
          statement: "Sample savings",
          money: "out",
          narrations: ["SAMPLE TRANSFER"],
          mapToAccount: "Sample card",
        },
        {
          statement: "Other savings",
          money: "out",
          narrations: ["SAMPLE TRANSFER"],
          mapToAccount: "Rent",
        },
        {
          statement: "Sample savings",
          money: "in",
          narrations: ["SAMPLE TRANSFER"],
          mapToAccount: "Salary",
        },
      ],
      contains: [],
    });
    expect(
      classify("SAMPLE TRANSFER", "withdrawal", "Sample savings", rules),
    ).toBe("Sample card");
    expect(
      classify("SAMPLE TRANSFER", "withdrawal", "Other savings", rules),
    ).toBe("Rent");
    expect(
      classify("SAMPLE TRANSFER", "deposit", "Sample savings", rules),
    ).toBe("Salary");
  });
});

describe("compileMappings", () => {
  const exactRule = (
    statement: string | string[],
    money: "in" | "out" | "either",
    narration: string,
    mapToAccount: string,
  ) => ({ statement, money, narrations: [narration], mapToAccount });

  it("refuses a rule that sends a statement's rows to its own account", () => {
    expect(() =>
      compileMappings(
        parse({
          exact: [],
          contains: [
            {
              statement: ["Sample card", "Sample savings"],
              money: "in",
              contains: ["PAYMENT"],
              mapToAccount: "Sample savings",
            },
          ],
        }),
        BOOKS,
      ),
    ).toThrow(
      /contains rule 1 \(→ "Sample savings"\) reads "Sample savings"'s own statement/,
    );
  });

  it("refuses a rule that reads the statement of an account the books don't have", () => {
    expect(() =>
      compileMappings(
        parse({
          exact: [exactRule("Sample savng", "out", "ACME", "Groceries")],
          contains: [],
        }),
        BOOKS,
      ),
    ).toThrow(
      /exact rule 1 \(→ "Groceries"\) reads the statement of "Sample savng", which is not an account in the books/,
    );
    expect(() =>
      compileMappings(
        parse({
          exact: [],
          contains: [
            {
              statement: ["Sample savings", "Gone card"],
              money: "out",
              contains: ["ACME"],
              mapToAccount: "Groceries",
            },
          ],
        }),
        BOOKS,
      ),
    ).toThrow(
      /contains rule 1 \(→ "Groceries"\) reads the statement of "Gone card"/,
    );
  });

  it("accepts an answer the books don't have yet", () => {
    expect(() =>
      compileMappings(
        parse({
          exact: [exactRule("*", "out", "ACME", "Not yet made")],
          contains: [],
        }),
        new Set(),
      ),
    ).not.toThrow();
  });

  it("refuses two exact rules that overlap with different accounts", () => {
    const overlapping = [
      // Same statement, same money, after normalization.
      [
        exactRule("Sample savings", "out", "acme supermarket", "Groceries"),
        exactRule("Sample savings", "out", "ACME  SUPERMARKET", "Food"),
      ],
      // "*" overlaps every statement.
      [
        exactRule("*", "out", "ACME", "Groceries"),
        exactRule("Sample savings", "out", "ACME", "Food"),
      ],
      // Lists overlap when they share a name; "either" overlaps both.
      [
        exactRule(["Sample savings", "Other"], "either", "ACME", "Groceries"),
        exactRule(["Other", "Sample card"], "in", "ACME", "Food"),
      ],
    ];
    for (const exact of overlapping) {
      expect(() =>
        compileMappings(parse({ exact, contains: [] }), BOOKS),
      ).toThrow(
        /exact rule 2 \(→ "Food"\) and exact rule 1 \(→ "Groceries"\) both match/,
      );
    }
  });

  it("accepts overlapping exact rules that agree, or that don't overlap", () => {
    const allowed = [
      [
        exactRule("*", "out", "acme supermarket", "Groceries"),
        exactRule("Sample savings", "either", "ACME  SUPERMARKET", "Groceries"),
      ],
      [
        exactRule("Sample savings", "out", "ACME", "Groceries"),
        exactRule("Other savings", "out", "ACME", "Food"),
      ],
      [
        exactRule("Sample savings", "out", "ACME", "Groceries"),
        exactRule("Sample savings", "in", "ACME", "Food"),
      ],
    ];
    for (const exact of allowed) {
      expect(() =>
        compileMappings(parse({ exact, contains: [] }), BOOKS),
      ).not.toThrow();
    }
  });
});

describe("mappingRulesSchema", () => {
  const withContains = (rule: Record<string, unknown>) =>
    mappingRulesSchema.safeParse({
      exact: [],
      contains: [
        {
          statement: "*",
          money: "out",
          contains: ["X"],
          mapToAccount: "Food",
          ...rule,
        },
      ],
    });

  it('turns "*", a name or a list into a statement scope', () => {
    const scopeOf = (statement: unknown) => {
      const parsed = withContains({ statement });
      return parsed.success ? parsed.data.contains[0].statement : null;
    };
    expect(scopeOf("*")).toEqual({ every: true });
    expect(scopeOf(" Sample savings ")).toEqual({
      every: false,
      accounts: ["Sample savings"],
    });
    expect(scopeOf(["Sample card", "Sample savings", "Sample card"])).toEqual({
      every: false,
      accounts: ["Sample card", "Sample savings"],
    });
    expect(scopeOf(["Sample card", "*"])).toBeNull();
    expect(scopeOf([])).toBeNull();
    expect(scopeOf("  ")).toBeNull();
  });

  it("requires a statement and a money", () => {
    expect(withContains({ statement: undefined }).success).toBe(false);
    expect(withContains({ money: undefined }).success).toBe(false);
    expect(withContains({ money: "withdrawal" }).success).toBe(false);
  });

  it("rejects an empty account name, and a rule with no text", () => {
    expect(withContains({ mapToAccount: "  " }).success).toBe(false);
    expect(withContains({ contains: [] }).success).toBe(false);
  });

  it("rejects an amount range with no end, or with its ends reversed", () => {
    const withAmount = (amount: unknown) => withContains({ amount }).success;
    expect(withAmount({ max: 500 })).toBe(true);
    expect(withAmount({ min: 100, max: 100 })).toBe(true);
    expect(withAmount({})).toBe(false);
    expect(withAmount({ min: 500, max: 100 })).toBe(false);
    expect(withAmount({ min: -1 })).toBe(false);
    expect(withAmount({ below: 500 })).toBe(false);
  });

  it("takes no amount on an exact rule, and no old field names", () => {
    expect(
      mappingRulesSchema.safeParse({
        exact: [
          {
            statement: "*",
            money: "out",
            narrations: ["X"],
            mapToAccount: "Food",
            amount: { max: 500 },
          },
        ],
        contains: [],
      }).success,
    ).toBe(false);
    expect(withContains({ account: "Food" }).success).toBe(false);
  });
});
