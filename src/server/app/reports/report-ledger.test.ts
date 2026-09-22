import { describe, expect, it } from "vitest";
import { openTestLedger } from "../../report-kit.js";

function books() {
  const test = openTestLedger();
  test.addAccount({ name: "Sample Bank", account_type: "Asset" });
  test.sqlite
    .prepare(
      `INSERT INTO accounts
         (workspace_id, scoped_to_user_id, name, account_type, created_at, updated_at)
       VALUES ('workspace', 'other-user', 'NOPII Other Bank', 'Asset', '2026-01-01', '2026-01-01')`,
    )
    .run();
  return test;
}

describe("a report's ledger", () => {
  it("reads only the signed-in user's rows", () => {
    const { ledger } = books();
    expect(
      ledger.all<{ name: string }>("SELECT name FROM scoped_accounts"),
    ).toEqual([{ name: "Sample Bank" }]);
    expect(
      ledger.one("SELECT name FROM scoped_accounts WHERE id = @id", { id: 2 }),
    ).toBeNull();
  });

  it("refuses a statement that writes, and leaves the books as they were", () => {
    const { ledger, sqlite } = books();
    expect(() =>
      ledger.all(
        "DELETE FROM accounts WHERE id IN (SELECT id FROM scoped_accounts)",
      ),
    ).toThrow("this statement writes");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM accounts").get()).toEqual({
      n: 2,
    });
  });
});
