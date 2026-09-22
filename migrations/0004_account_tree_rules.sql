-- The account tree's rules, kept by the database. An account's parent is an
-- account in the same workspace, for the same user, with the same account
-- type, and following parents up from an account never comes back to it.
-- Reports build the tree from `parent_id` (app/account-tree.ts) and fail on a
-- loop; these triggers refuse the write that would make one.
--
-- SQLite checks each row as it is written, so one statement can't move a
-- whole branch to another workspace, user or type: take the sub-accounts off,
-- change the parent, and put them back.
--
-- A table's triggers are dropped with it. A migration that rebuilds `accounts`
-- must create these again; schema/accounts.test.ts fails until it does.

-- Triggers check new writes only, so the migration stops here if a row
-- already breaks a rule, failing the CHECK by its name.
CREATE TEMP TABLE `accounts_tree_precheck` (
	`broken` integer NOT NULL CONSTRAINT `accounts_already_break_tree_rules` CHECK (`broken` = 0)
);
--> statement-breakpoint
INSERT INTO `accounts_tree_precheck` (`broken`)
SELECT
	(
		SELECT COUNT(*)
		FROM accounts child
		JOIN accounts parent ON parent.id = child.parent_id
		WHERE parent.workspace_id IS NOT child.workspace_id
			OR parent.scoped_to_user_id IS NOT child.scoped_to_user_id
			OR parent.account_type IS NOT child.account_type
	) + (
		WITH RECURSIVE walk(start, id) AS (
			SELECT id, parent_id FROM accounts WHERE parent_id IS NOT NULL
			UNION
			SELECT walk.start, a.parent_id
			FROM walk
			JOIN accounts a ON a.id = walk.id
			WHERE a.parent_id IS NOT NULL
		)
		SELECT COUNT(*) FROM walk WHERE start = id
	);
--> statement-breakpoint
DROP TABLE `accounts_tree_precheck`;
--> statement-breakpoint
CREATE TRIGGER `accounts_tree_rules_on_insert`
BEFORE INSERT ON `accounts`
WHEN NEW.parent_id IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'An account''s parent must be in the same workspace, for the same user, with the same account type.')
	FROM accounts parent
	WHERE parent.id = NEW.parent_id
		AND (parent.workspace_id IS NOT NEW.workspace_id
			OR parent.scoped_to_user_id IS NOT NEW.scoped_to_user_id
			OR parent.account_type IS NOT NEW.account_type);
	SELECT RAISE(ABORT, 'An account can''t sit under itself or one of its own sub-accounts.')
	WHERE EXISTS (
		WITH RECURSIVE ancestor(id) AS (
			SELECT NEW.parent_id
			UNION
			SELECT a.parent_id
			FROM accounts a
			JOIN ancestor ON a.id = ancestor.id
			WHERE a.parent_id IS NOT NULL
		)
		SELECT 1 FROM ancestor WHERE id = NEW.id
	);
END;
--> statement-breakpoint
-- The insert trigger's two checks, then the account's own sub-accounts: they
-- must still match it.
CREATE TRIGGER `accounts_tree_rules_on_update`
BEFORE UPDATE OF id, parent_id, workspace_id, scoped_to_user_id, account_type ON `accounts`
BEGIN
	SELECT RAISE(ABORT, 'An account''s parent must be in the same workspace, for the same user, with the same account type.')
	FROM accounts parent
	WHERE parent.id = NEW.parent_id
		AND (parent.workspace_id IS NOT NEW.workspace_id
			OR parent.scoped_to_user_id IS NOT NEW.scoped_to_user_id
			OR parent.account_type IS NOT NEW.account_type);
	SELECT RAISE(ABORT, 'An account can''t sit under itself or one of its own sub-accounts.')
	WHERE EXISTS (
		WITH RECURSIVE ancestor(id) AS (
			SELECT NEW.parent_id
			UNION
			SELECT a.parent_id
			FROM accounts a
			JOIN ancestor ON a.id = ancestor.id
			WHERE a.parent_id IS NOT NULL
		)
		SELECT 1 FROM ancestor WHERE id = NEW.id
	);
	SELECT RAISE(ABORT, 'An account with sub-accounts must keep its workspace, user and account type.')
	WHERE EXISTS (
		SELECT 1
		FROM accounts child
		WHERE child.parent_id = OLD.id
			AND (child.workspace_id IS NOT NEW.workspace_id
				OR child.scoped_to_user_id IS NOT NEW.scoped_to_user_id
				OR child.account_type IS NOT NEW.account_type)
	);
END;
