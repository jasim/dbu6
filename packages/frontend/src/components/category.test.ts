import { describe, expect, it } from "vitest";
import { accountPathName } from "dbu6-shared";
import { accountHue, categoryHueColor, ownHue } from "./category";

// accountPathName lives in dbu6-shared, which has no test runner of its own;
// the API names accounts with it too.
describe("account path names", () => {
  it("reads the last segment as a friendly name", () => {
    expect(accountPathName("expenses:food:food-delivery")).toBe(
      "Food delivery",
    );
    expect(accountPathName("expenses:child:school-fees")).toBe("School fees");
    expect(accountPathName("expenses:food")).toBe("Food");
    expect(accountPathName("income:salary:gross-pay")).toBe("Gross pay");
  });

  it("copes with blanks and odd separators", () => {
    expect(accountPathName("")).toBe("");
    expect(accountPathName("expenses:")).toBe("Expenses");
    expect(accountPathName("assets:bank:hdfc_savings")).toBe("Hdfc savings");
  });
});

describe("account hues", () => {
  it("takes the hue the account's own name asks for", () => {
    expect(ownHue("expenses:food")).toBe("food");
    expect(ownHue("expenses:taxes")).toBe("taxes");
    expect(ownHue("Expenses:Food ")).toBe("food");
    expect(ownHue("expenses:food:groceries")).toBeNull();
    expect(ownHue("expenses")).toBeNull();
    expect(ownHue("")).toBeNull();
  });

  it("maps the seeded group names onto the design's hue keys", () => {
    expect(ownHue("expenses:housing")).toBe("home");
    expect(ownHue("expenses:child")).toBe("children");
    expect(ownHue("expenses:entertainment")).toBe("fun");
    expect(ownHue("expenses:education")).toBe("learning");
    expect(ownHue("expenses:finance")).toBe("fees");
  });

  it("inherits the parent's colour, and never asks for the fallback", () => {
    expect(accountHue("expenses:food:groceries", "food")).toBe("food");
    expect(accountHue("expenses:food:other", "food")).toBe("food");
    expect(accountHue("expenses:shopping:travel", "shopping")).toBe("travel");
    expect(accountHue("income:salary")).toBe("other");
    expect(accountHue("expenses")).toBe("other");
  });

  it("names the CSS variable app.css defines", () => {
    expect(categoryHueColor("home")).toBe("var(--cat-home)");
    expect(categoryHueColor(accountHue("expenses:housing"))).toBe(
      "var(--cat-home)",
    );
  });
});
