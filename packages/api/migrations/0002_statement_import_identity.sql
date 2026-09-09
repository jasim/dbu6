ALTER TABLE `draft_transactions` ADD `source_reference` text;--> statement-breakpoint
ALTER TABLE `draft_transactions` ADD `source_transaction_key` text;--> statement-breakpoint
CREATE INDEX `draft_transactions_source_key_idx` ON `draft_transactions` (`workspace_id`,`scoped_to_user_id`,`base_account_id`,`source_transaction_key`);--> statement-breakpoint
ALTER TABLE `journal_entries` ADD `source_reference` text;--> statement-breakpoint
ALTER TABLE `journal_entries` ADD `source_transaction_key` text;--> statement-breakpoint
CREATE INDEX `journal_entries_source_key_idx` ON `journal_entries` (`workspace_id`,`scoped_to_user_id`,`source_transaction_key`);