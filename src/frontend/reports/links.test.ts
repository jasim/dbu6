import { describe, expect, it } from "vitest";
import { accountLedgerHref } from "./links";

describe("accountLedgerHref", () => {
  const params = (href: string | null) =>
    Object.fromEntries(new URL(href ?? "", "http://x").searchParams);

  it("opens a balance as of a day on its financial year to that day", () => {
    expect(params(accountLedgerHref(7, { to_date: "2026-07-31" }))).toEqual({
      account_id: "7",
      from_date: "2026-04-01",
      to_date: "2026-07-31",
    });
    // March is the year before's.
    expect(
      params(accountLedgerHref(7, { to_date: "2026-03-31" })).from_date,
    ).toBe("2025-04-01");
  });

  it("carries a report's period over as it is", () => {
    expect(
      params(
        accountLedgerHref(7, { from_date: "2026-05-01", to_date: "2026-05-31" }),
      ),
    ).toEqual({
      account_id: "7",
      from_date: "2026-05-01",
      to_date: "2026-05-31",
    });
    expect(params(accountLedgerHref(7, {}))).toEqual({
      account_id: "7",
      period: "all-time",
    });
  });
});
