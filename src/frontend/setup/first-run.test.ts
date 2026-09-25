import { describe, expect, it } from "vitest";
import { setupRedirect } from "./first-run";

describe("where /setup sends the books", () => {
  it("shows card 1 to books with no accounts", () => {
    expect(setupRedirect({ accounts: 0, imported_accounts: 0 })).toBeNull();
  });

  it("goes on to card 2 until a bank or card has transactions", () => {
    expect(setupRedirect({ accounts: 12, imported_accounts: 0 })).toBe(
      "/add?run=setup",
    );
  });

  it("goes Home once one has", () => {
    expect(setupRedirect({ accounts: 12, imported_accounts: 1 })).toBe("/");
  });
});
