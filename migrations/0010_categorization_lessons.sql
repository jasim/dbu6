CREATE TABLE `categorization_lessons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`scoped_to_user_id` text NOT NULL,
	`base_account_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`narrations` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`base_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `categorization_lessons_base_account_idx` ON `categorization_lessons` (`workspace_id`,`scoped_to_user_id`,`base_account_id`);