ALTER TABLE `user` ADD `share_token` text;--> statement-breakpoint
ALTER TABLE `user` ADD `share_scope` text;--> statement-breakpoint
CREATE UNIQUE INDEX `user_share_token_unique` ON `user` (`share_token`);