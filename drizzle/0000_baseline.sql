CREATE SCHEMA IF NOT EXISTS "nextsode" AUTHORIZATION postgres;

--> statement-breakpoint
CREATE TABLE "nextsode"."media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tmdb_id" integer NOT NULL,
	"media_type" text NOT NULL,
	"title" text NOT NULL,
	"poster_path" text,
	"release_date" date,
	"overview" text,
	"vote_average" real,
	"total_seasons" smallint,
	"aired_seasons" smallint,
	"next_season_number" smallint,
	"next_season_air_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_tmdb_id_media_type_unique" UNIQUE("tmdb_id","media_type"),
	CONSTRAINT "media_tmdb_id_check" CHECK ("nextsode"."media"."tmdb_id" > 0),
	CONSTRAINT "media_media_type_check" CHECK ("nextsode"."media"."media_type" in ('movie', 'tv')),
	CONSTRAINT "media_vote_average_check" CHECK ("nextsode"."media"."vote_average" between 0 and 10),
	CONSTRAINT "media_total_seasons_check" CHECK ("nextsode"."media"."total_seasons" >= 0),
	CONSTRAINT "media_aired_seasons_check" CHECK ("nextsode"."media"."aired_seasons" >= 0),
	CONSTRAINT "media_next_season_number_check" CHECK ("nextsode"."media"."next_season_number" > 0)
);

--> statement-breakpoint
ALTER TABLE "nextsode"."media" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "nextsode"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_id_hash_check" CHECK ("nextsode"."session"."id" ~ '^[0-9a-f]{64}$')
);

--> statement-breakpoint
ALTER TABLE "nextsode"."session" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "nextsode"."app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"auto_delete_days" smallint,
	"calendar_token" text,
	"share_token" text,
	"share_scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "app_user_calendar_token_unique" UNIQUE("calendar_token"),
	CONSTRAINT "app_user_share_token_unique" UNIQUE("share_token"),
	CONSTRAINT "app_user_auto_delete_days_check" CHECK ("nextsode"."app_user"."auto_delete_days" in (7, 30, 90)),
	CONSTRAINT "app_user_share_scope_check" CHECK ("nextsode"."app_user"."share_scope" in ('toWatch', 'watched', 'both')),
	CONSTRAINT "app_user_share_scope_with_token" CHECK ("nextsode"."app_user"."share_token" is null or "nextsode"."app_user"."share_scope" is not null)
);

--> statement-breakpoint
ALTER TABLE "nextsode"."app_user" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "nextsode"."watchlist_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"watched" boolean DEFAULT false NOT NULL,
	"seasons_seen" smallint DEFAULT 0 NOT NULL,
	"episodes_into_season" smallint DEFAULT 0 NOT NULL,
	"watched_at" timestamp with time zone,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_item_user_media_unique" UNIQUE("user_id","media_id"),
	CONSTRAINT "watchlist_item_seasons_seen_check" CHECK ("nextsode"."watchlist_item"."seasons_seen" >= 0),
	CONSTRAINT "watchlist_item_episodes_into_season_check" CHECK ("nextsode"."watchlist_item"."episodes_into_season" >= 0)
);

--> statement-breakpoint
ALTER TABLE "nextsode"."watchlist_item" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "nextsode"."session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "nextsode"."app_user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "nextsode"."watchlist_item" ADD CONSTRAINT "watchlist_item_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "nextsode"."app_user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "nextsode"."watchlist_item" ADD CONSTRAINT "watchlist_item_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "nextsode"."media"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "nextsode"."session" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "watchlist_item_media_id_idx" ON "nextsode"."watchlist_item" USING btree ("media_id");
