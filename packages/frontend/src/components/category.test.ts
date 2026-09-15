import { describe, expect, it } from "vitest";
import { accountPathName } from "dbu6-shared";
import { categoryGroup, categoryHue, categoryHueColor } from "./category";

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

describe("category groups and hues", () => {
  it("takes the group after the bookkeeping prefix", () => {
    expect(categoryGroup("expenses:food:food-delivery")).toBe("food");
    expect(categoryGroup("income:salary:gross-pay")).toBe("salary");
    expect(categoryGroup("food:groceries")).toBe("food");
    expect(categoryGroup("expenses")).toBeNull();
    expect(categoryGroup("")).toBeNull();
  });

  it("maps the seeded group names onto the design's hue keys", () => {
    expect(categoryHue("expenses:housing:rent")).toBe("home");
    expect(categoryHue("expenses:child:activities")).toBe("children");
    expect(categoryHue("expenses:entertainment:movies")).toBe("fun");
    expect(categoryHue("expenses:education:courses-books")).toBe("learning");
    expect(categoryHue("expenses:finance:bank-charges")).toBe("fees");
    expect(categoryHue("expenses:food:groceries")).toBe("food");
    expect(categoryHue("expenses:taxes:income-tax")).toBe("taxes");
  });

  it("falls back to the neutral hue for groups without one", () => {
    expect(categoryHue("income:salary:gross-pay")).toBe("other");
    expect(categoryHue("assets:bank:sample-savings")).toBe("other");
    expect(categoryHue("")).toBe("other");
  });

  it("names the CSS variable app.css defines", () => {
    expect(categoryHueColor("home")).toBe("var(--cat-home)");
    expect(categoryHueColor(categoryHue("expenses:housing:rent"))).toBe(
      "var(--cat-home)",
    );
  });
});
