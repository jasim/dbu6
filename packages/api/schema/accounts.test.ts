import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The account tree's rules (migrations/0004_account_tree_rules.sql), on a
 * database migrated from scratch: a later migration that rebuilds `accounts`
 * without its triggers fails here.
 *
 * Food (1) has groceries (2) and dining (3), and dining has restaurants (4).
 * Rent (5) and salary (6, income) have no children. The last two sit in
 * another workspace (7) and on another user's books (8).
 */
function books(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
  });
  sqlite.exec(`
    INSERT INTO accounts
      (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
    VALUES
      (1, 'workspace', 'user', 'expenses:food', NULL, 'Expense', '', ''),
      (2, 'workspace', 'user', 'expenses:food:groceries', 1, 'Expense', '', ''),
      (3, 'workspace', 'user', 'expenses:food:dining', 1, 'Expense', '', ''),
      (4, 'workspace', 'user', 'expenses:food:dining:restaurants', 3, 'Expense', '', ''),
      (5, 'workspace', 'user', 'expenses:rent', NULL, 'Expense', '', ''),
      (6, 'workspace', 'user', 'income:salary', NULL, 'Revenue', '', ''),
      (7, 'other-workspace', 'user', 'expenses:food', NULL, 'Expense', '', ''),
      (8, 'workspace', 'other-user', 'expenses:food', NULL, 'Expense', '', '');
  `);
  return sqlite;
}

function insertUnder(parentId: number, overrides = "'workspace', 'user'") {
  return `
    INSERT INTO accounts
      (workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
    VALUES (${overrides}, 'expenses:sample', ${parentId}, 'Expense', '', '')`;
}

const parentRule =
  "An account's parent must be in the same workspace, for the same user, with the same account type.";
const loopRule =
  "An account can't sit under itself or one of its own sub-accounts.";
const childrenRule =
  "An account with sub-accounts must keep its workspace, user and account type.";

describe("accounts.parent_id", () => {
  it("takes any account in the same workspace, user and type", () => {
    const sqlite = books();

    sqlite.exec("UPDATE accounts SET parent_id = 5 WHERE id = 3");
    sqlite.exec(insertUnder(4));
    sqlite.exec("UPDATE accounts SET parent_id = NULL WHERE id = 2");
    sqlite.exec("UPDATE accounts SET account_type = 'Revenue' WHERE id = 2");

    expect(
      sqlite
        .prepare("SELECT id, parent_id FROM accounts WHERE id <= 4 ORDER BY id")
        .all(),
    ).toEqual([
      { id: 1, parent_id: null },
      { id: 2, parent_id: null },
      { id: 3, parent_id: 5 },
      { id: 4, parent_id: 3 },
    ]);
  });

  it("refuses a parent in another workspace, for another user or of another type", () => {
    const sqlite = books();

    expect(() => sqlite.exec(insertUnder(7))).toThrow(parentRule);
    expect(() => sqlite.exec(insertUnder(6))).toThrow(parentRule);
    expect(() =>
      sqlite.exec(insertUnder(1, "'workspace', 'other-user'")),
    ).toThrow(parentRule);
    expect(() =>
      sqlite.exec("UPDATE accounts SET parent_id = 8 WHERE id = 2"),
    ).toThrow(parentRule);
    expect(() =>
      sqlite.exec("UPDATE accounts SET parent_id = 6 WHERE id = 2"),
    ).toThrow(parentRule);
    expect(() =>
      sqlite.exec("UPDATE accounts SET account_type = 'Revenue' WHERE id = 4"),
    ).toThrow(parentRule);
  });

  it("refuses a loop", () => {
    const sqlite = books();

    expect(() =>
      sqlite.exec("UPDATE accounts SET parent_id = 1 WHERE id = 1"),
    ).toThrow(loopRule);
    expect(() =>
      sqlite.exec("UPDATE accounts SET parent_id = 4 WHERE id = 1"),
    ).toThrow(loopRule);
    expect(() =>
      sqlite.exec(
        "UPDATE accounts SET parent_id = CASE id WHEN 5 THEN 1 ELSE 5 END WHERE id IN (1, 5)",
      ),
    ).toThrow(loopRule);
    expect(() =>
      sqlite.exec(`
        INSERT INTO accounts
          (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
        VALUES (9, 'workspace', 'user', 'expenses:sample', 9, 'Expense', '', '')`),
    ).toThrow(loopRule);
  });

  it("refuses moving an account with sub-accounts to another workspace, user or type", () => {
    const sqlite = books();

    expect(() =>
      sqlite.exec("UPDATE accounts SET account_type = 'Revenue' WHERE id = 1"),
    ).toThrow(childrenRule);
    expect(() =>
      sqlite.exec(
        "UPDATE accounts SET workspace_id = 'other-workspace' WHERE id = 1",
      ),
    ).toThrow(childrenRule);
    expect(() =>
      sqlite.exec(
        "UPDATE accounts SET scoped_to_user_id = 'other-user' WHERE id = 1",
      ),
    ).toThrow(childrenRule);
  });
});
