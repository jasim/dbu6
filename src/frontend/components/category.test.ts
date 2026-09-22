import { describe, expect, it } from "vitest";
import { accountHue, categoryHueColor, ownHue } from "./category";

describe("account hues", () => {
  it("takes the hue the account's own name asks for, in any case", () => {
    expect(ownHue("Food")).toBe("food");
    expect(ownHue("taxes")).toBe("taxes");
    expect(ownHue(" Food ")).toBe("food");
    expect(ownHue("Groceries")).toBeNull();
    expect(ownHue("Expenses")).toBeNull();
    expect(ownHue("")).toBeNull();
  });

  it("maps the seeded group names onto the design's hue keys", () => {
    expect(ownHue("Housing")).toBe("home");
    expect(ownHue("Children")).toBe("children");
    expect(ownHue("Entertainment")).toBe("fun");
    expect(ownHue("Education")).toBe("learning");
    expect(ownHue("Finance")).toBe("fees");
  });

  it("inherits the parent's colour, and never asks for the fallback", () => {
    expect(accountHue("Groceries", "food")).toBe("food");
    expect(accountHue("Other", "food")).toBe("food");
    expect(accountHue("Travel", "shopping")).toBe("travel");
    expect(accountHue("Salary")).toBe("other");
    expect(accountHue("Expenses")).toBe("other");
  });

  it("names the CSS variable frontend.css defines", () => {
    expect(categoryHueColor("home")).toBe("var(--cat-home)");
    expect(categoryHueColor(accountHue("Housing"))).toBe("var(--cat-home)");
  });
});
