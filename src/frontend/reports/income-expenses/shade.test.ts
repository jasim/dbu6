import { describe, expect, it } from "vitest";
import { shadeColor, shades } from "./shade";

describe("shades", () => {
  it("run from the least to the most", () => {
    expect(shades([1000, 4000, 2500])).toEqual([0, 1, 0.5]);
  });

  it("stay close when the values barely differ", () => {
    const [low, high] = shades([900, 1000]) as [number, number];
    expect(high).toBe(1);
    expect(low).toBeCloseTo(0.7);
  });

  it("leave nothing and refunds unshaded", () => {
    expect(shades([0, -50, 200])).toEqual([null, null, 1]);
    expect(shades([0, 0])).toEqual([null, null]);
  });

  it("mix the section's two steps", () => {
    expect(shadeColor("spending", 0.25)).toBe(
      "color-mix(in oklch, var(--spend-most) 25%, var(--spend-least))",
    );
    expect(shadeColor("income", 1)).toContain("var(--income-most) 100%");
  });
});
