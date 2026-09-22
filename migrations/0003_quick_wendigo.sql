-- The default doubles as the backfill: SQLite writes it into every row
-- already present, and the accounts and workspaces already here keep
-- Asia/Calcutta (+05:30) -- the calendar these books have always been on.
-- See `user.timeZone` in project-auth/schema.ts for why the column carries
-- a default at all.
ALTER TABLE `organization` ADD `timeZone` text DEFAULT 'Asia/Calcutta' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `timeZone` text DEFAULT 'Asia/Calcutta' NOT NULL;