-- A lesson keeps its drafts' date, direction and amount beside the narration,
-- `{ date, narration, direction, amount }[]`, where it kept the narrations
-- alone. A lesson's drafts wait in Review without a category, so each one
-- saved before this is filled in from the account's drafts with one of its
-- narrations; a lesson none of whose drafts is left goes.
ALTER TABLE `categorization_lessons` RENAME COLUMN `narrations` TO `transactions`;
--> statement-breakpoint
UPDATE `categorization_lessons`
SET `transactions` = (
  SELECT json_group_array(json_object(
    'date', d.`date`,
    'narration', d.`narration`,
    'direction', CASE WHEN d.`deposit` > 0 THEN 'deposit' ELSE 'withdrawal' END,
    'amount', CASE WHEN d.`deposit` > 0 THEN d.`deposit` ELSE d.`withdrawal` END
  ))
  FROM (
    SELECT * FROM `draft_transactions` AS dt
    WHERE dt.`workspace_id` = `categorization_lessons`.`workspace_id`
      AND dt.`scoped_to_user_id` = `categorization_lessons`.`scoped_to_user_id`
      AND dt.`base_account_id` = `categorization_lessons`.`base_account_id`
      AND dt.`narration` IN (
        SELECT `value` FROM json_each(`categorization_lessons`.`transactions`)
      )
    ORDER BY dt.`date`, dt.`id`
  ) AS d
);
--> statement-breakpoint
DELETE FROM `categorization_lessons` WHERE json_array_length(`transactions`) = 0;
