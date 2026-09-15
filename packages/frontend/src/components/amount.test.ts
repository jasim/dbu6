import { describe, expect, it } from "vitest";
import { formatAmount, MINUS } from "./amount";

describe("formatAmount", () => {
  it("groups in the Indian style with two decimals", () => {
    expect(formatAmount(445785, "in")).toBe("+4,45,785.00");
    expect(formatAmount(350560, "out")).toBe(`${MINUS}3,50,560.00`);
    expect(formatAmount(3755785.5, "in")).toBe("+37,55,785.50");
    expect(formatAmount(680, "out")).toBe(`${MINUS}680.00`);
  });

  it("always shows a sign, never a hyphen for money out", () => {
    expect(formatAmount(0, "in")).toBe("+0.00");
    expect(formatAmount(0, "out")).toBe(`${MINUS}0.00`);
    expect(formatAmount(-500, "out")).toBe(`${MINUS}500.00`);
    expect(formatAmount(-500, "out")).not.toContain("-");
  });

  it("puts the rupee sign after the sign when asked", () => {
    expect(formatAmount(95225, "in", { symbol: true })).toBe("+₹95,225.00");
    expect(formatAmount(2481560, "out", { symbol: true })).toBe(
      `${MINUS}₹24,81,560.00`,
    );
  });
});
