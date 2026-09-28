-- The user's pending instructions to the categoriser are rule requests, the
-- name the tab, the prompt and the books guide now use. The table and its
-- index take it too, so one word names the thing everywhere.
ALTER TABLE `categorization_lessons` RENAME TO `categorization_rule_requests`;--> statement-breakpoint
DROP INDEX `categorization_lessons_base_account_idx`;--> statement-breakpoint
CREATE INDEX `categorization_rule_requests_base_account_idx` ON `categorization_rule_requests` (`workspace_id`,`scoped_to_user_id`,`base_account_id`);
