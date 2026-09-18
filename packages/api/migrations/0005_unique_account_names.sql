-- An account's name is unique in a user's books: mapping rules, import
-- presets and the LLM name an account by it. This fails on a database where
-- two of one user's accounts already share a name; rename one first.
CREATE UNIQUE INDEX `accounts_name_unique` ON `accounts` (`workspace_id`,`scoped_to_user_id`,`name`);