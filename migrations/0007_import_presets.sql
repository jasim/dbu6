CREATE TABLE `import_presets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`scoped_to_user_id` text NOT NULL,
	`name` text NOT NULL,
	`parsers` text NOT NULL,
	`accounts` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_presets_name_unique` ON `import_presets` (`workspace_id`,`scoped_to_user_id`,`name`);