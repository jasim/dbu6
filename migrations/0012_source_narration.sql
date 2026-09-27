-- Every imported row keeps two texts: `source_narration`, the statement's
-- text as the import saw it, and `comment`, the person's readable line.
-- A draft's narration becomes its source narration. Every journal entry's
-- comment moves to its source narration, because an imported comment and a
-- typed one can't be told apart; the comment writer fills comments afresh.
-- A lesson's copied drafts name their text `source_narration` too.
ALTER TABLE `draft_transactions` RENAME COLUMN "narration" TO "source_narration";--> statement-breakpoint
ALTER TABLE `draft_transactions` ADD `comment` text;--> statement-breakpoint
ALTER TABLE `journal_entries` ADD `source_narration` text;--> statement-breakpoint
UPDATE `journal_entries` SET `source_narration` = `comment`, `comment` = NULL
  WHERE `comment` IS NOT NULL AND trim(`comment`) <> '';
--> statement-breakpoint
UPDATE `categorization_lessons`
SET `transactions` = (
  SELECT json_group_array(json_object(
    'date', json_extract(t.`value`, '$.date'),
    'source_narration', json_extract(t.`value`, '$.narration'),
    'direction', json_extract(t.`value`, '$.direction'),
    'amount', json_extract(t.`value`, '$.amount')
  ))
  FROM json_each(`categorization_lessons`.`transactions`) AS t
);
