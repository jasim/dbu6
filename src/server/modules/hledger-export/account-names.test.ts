import { describe, expect, it } from "vitest";
import { escapeAccountSegment, hledgerAccountPaths } from "./account-names.js";
import type { ExportAccount } from "./model.js";

describe("escapeAccountSegment", () => {
  const escape = (name: string) => escapeAccountSegment(name, "fallback");

  it("keeps a plain name, single spaces, punctuation and other scripts", () => {
    expect(escape("Dining Out")).toBe("Dining Out");
    expect(escape("Food & Drink; misc #2")).toBe("Food & Drink; misc #2");
    expect(escape("050505")).toBe("050505");
    expect(escape("ಉಳಿತಾಯ ₹ café")).toBe("ಉಳಿತಾಯ ₹ café");
  });

  it("turns a colon into a dash, so one name stays one segment", () => {
    expect(escape("Sample:Savings")).toBe("Sample-Savings");
    expect(escape("Sample::Savings")).toBe("Sample--Savings");
  });

  it("never leaves two spaces, a tab or a newline", () => {
    expect(escape("Sample  Savings")).toBe("Sample Savings");
    expect(escape("Sample\tSavings")).toBe("Sample Savings");
    expect(escape("Sample\r\nSavings\u00a0Account ")).toBe(
      "Sample Savings Account",
    );
  });

  it("drops a leading status mark or comment character", () => {
    expect(escape("*Starred")).toBe("Starred");
    expect(escape("! * Flagged")).toBe("Flagged");
    expect(escape(";Commented")).toBe("Commented");
  });

  it("drops a leading bracket with its closer, so nothing reads as virtual", () => {
    expect(escape("(Old) Savings")).toBe("Old Savings");
    expect(escape("[Budget]")).toBe("Budget");
    expect(escape("(unclosed")).toBe("unclosed");
    expect(escape("Savings (old)")).toBe("Savings (old)");
  });

  it("falls back when nothing is left", () => {
    expect(escape("")).toBe("fallback");
    expect(escape("  \t ")).toBe("fallback");
    expect(escape("*!;")).toBe("fallback");
    expect(escape("()")).toBe("fallback");
  });

  it("normalizes to NFC", () => {
    expect(escape("café")).toBe("café");
  });
});

describe("hledgerAccountPaths", () => {
  const account = (
    id: number,
    name: string,
    parent_id: number | null = null,
  ): ExportAccount => ({ id, name, parent_id, account_type: "Expense" });

  it("joins the escaped names down the parent_id branch", () => {
    const paths = hledgerAccountPaths([
      account(3, "Dining: Out", 2),
      account(1, "Expenses"),
      account(2, "Food", 1),
    ]);
    expect(paths.get(3)).toBe("Expenses:Food:Dining- Out");
  });

  it("gives a later colliding account its id, and its children follow", () => {
    const paths = hledgerAccountPaths([
      account(1, "Expenses"),
      account(5, "Food:Home", 1),
      account(2, "Food-Home", 1),
      account(6, "Milk", 5),
      account(7, "", 1),
    ]);
    expect(paths.get(2)).toBe("Expenses:Food-Home");
    expect(paths.get(5)).toBe("Expenses:Food-Home-5");
    expect(paths.get(6)).toBe("Expenses:Food-Home-5:Milk");
    expect(paths.get(7)).toBe("Expenses:account-7");
  });

  it("throws on a parent loop", () => {
    expect(() =>
      hledgerAccountPaths([account(1, "A", 2), account(2, "B", 1)]),
    ).toThrow(/loops/);
  });
});
