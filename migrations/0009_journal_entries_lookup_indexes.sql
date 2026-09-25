CREATE INDEX `journal_entries_journal_idx` ON `journal_entries` (`journal_id`);--> statement-breakpoint
CREATE INDEX `journal_entries_account_idx` ON `journal_entries` (`account_id`);