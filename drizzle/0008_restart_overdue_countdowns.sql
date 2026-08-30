-- One-time repair for the switch from archiving to deletion.
--
-- Archived rows kept the `watched_at` they had when they were tidied away, so
-- dropping `archived_at` handed them back to their owner already past the
-- window — due to be deleted on the very next page load, having never shown the
-- week of warning the card exists to give. Anything else stranded past its
-- window by that change is in the same position.
--
-- Restarting the clock costs those titles one more window on the list and buys
-- back the warning. `setAutoDelete` now does the same thing whenever a window is
-- picked, so this is the backfill for lists that already had one set.
UPDATE `watchlist_item`
SET `watched_at` = unixepoch()
WHERE `watched` = 1
	AND `watched_at` IS NOT NULL
	AND EXISTS (
		SELECT 1
		FROM `user`
		WHERE `user`.`id` = `watchlist_item`.`user_id`
			AND `user`.`auto_delete_days` IS NOT NULL
			AND `watchlist_item`.`watched_at` < unixepoch() - `user`.`auto_delete_days` * 86400
	);
