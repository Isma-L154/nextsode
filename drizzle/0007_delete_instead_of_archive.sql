ALTER TABLE `user` RENAME COLUMN `auto_archive_days` TO `auto_delete_days`;--> statement-breakpoint
ALTER TABLE `watchlist_item` DROP COLUMN `archived_at`;
