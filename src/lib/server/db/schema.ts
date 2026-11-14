import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	date,
	index,
	integer,
	pgSchema,
	real,
	smallint,
	text,
	timestamp,
	unique,
	uuid
} from 'drizzle-orm/pg-core';

export const nextsode = pgSchema('nextsode');
const timestamps = () => ({
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

// Each private row has one owner and only that owner writes it; created_by and
// updated_by would repeat that relationship. Media contains only public TMDB data.
export const user = nextsode
	.table(
		'app_user',
		{
			id: uuid('id').primaryKey().defaultRandom(),
			// Google's stable sub claim survives email changes.
			googleId: text('google_id').notNull().unique(),
			email: text('email').notNull(),
			name: text('name').notNull(),
			avatarUrl: text('avatar_url'),
			// Null keeps deletion opt-in; there is no archive to recover a removed title.
			autoDeleteDays: smallint('auto_delete_days'),
			// These URLs must be shown again on another device, so unlike session tokens
			// they cannot be hashed. Separate tokens let owners revoke each audience apart.
			calendarToken: text('calendar_token').unique(),
			shareToken: text('share_token').unique(),
			shareScope: text('share_scope'),
			...timestamps()
		},
		(t) => [
			check('app_user_auto_delete_days_check', sql`${t.autoDeleteDays} in (7, 30, 90)`),
			check('app_user_share_scope_check', sql`${t.shareScope} in ('toWatch', 'watched', 'both')`),
			check(
				'app_user_share_scope_with_token',
				sql`${t.shareToken} is null or ${t.shareScope} is not null`
			)
		]
	)
	.enableRLS();

// Only the SHA-256 hash is stored: a database dump cannot replay the cookie.
export const session = nextsode
	.table(
		'session',
		{
			id: text('id').primaryKey(),
			userId: uuid('user_id')
				.notNull()
				.references(() => user.id, { onDelete: 'cascade' }),
			expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
			createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
		},
		(t) => [
			index('session_user_id_idx').on(t.userId),
			check('session_id_hash_check', sql`${t.id} ~ '^[0-9a-f]{64}$'`)
		]
	)
	.enableRLS();

export const media = nextsode
	.table(
		'media',
		{
			id: uuid('id').primaryKey().defaultRandom(),
			tmdbId: integer('tmdb_id').notNull(),
			mediaType: text('media_type', { enum: ['movie', 'tv'] }).notNull(),
			title: text('title').notNull(),
			posterPath: text('poster_path'),
			releaseDate: date('release_date', { mode: 'string' }),
			overview: text('overview'),
			voteAverage: real('vote_average'),
			/**
			 * Three states: null means not known yet, 0 means TMDB has no season data
			 * (NO_SEASON_DATA stops endless backfill), and a positive number is its count.
			 * Aired seasons exclude announcements: progress must never reach an unaired
			 * season. The next premiere's date schedules the read-path refresh.
			 */
			totalSeasons: smallint('total_seasons'),
			airedSeasons: smallint('aired_seasons'),
			nextSeasonNumber: smallint('next_season_number'),
			nextSeasonAirDate: date('next_season_air_date', { mode: 'string' }),
			...timestamps()
		},
		(t) => [
			unique('media_tmdb_id_media_type_unique').on(t.tmdbId, t.mediaType),
			check('media_tmdb_id_check', sql`${t.tmdbId} > 0`),
			check('media_media_type_check', sql`${t.mediaType} in ('movie', 'tv')`),
			check('media_vote_average_check', sql`${t.voteAverage} between 0 and 10`),
			check('media_total_seasons_check', sql`${t.totalSeasons} >= 0`),
			check('media_aired_seasons_check', sql`${t.airedSeasons} >= 0`),
			check('media_next_season_number_check', sql`${t.nextSeasonNumber} > 0`)
		]
	)
	.enableRLS();

export const watchlistItem = nextsode
	.table(
		'watchlist_item',
		{
			id: uuid('id').primaryKey().defaultRandom(),
			userId: uuid('user_id')
				.notNull()
				.references(() => user.id, { onDelete: 'cascade' }),
			mediaId: uuid('media_id')
				.notNull()
				.references(() => media.id, { onDelete: 'restrict' }),
			watched: boolean('watched').notNull().default(false),
			seasonsSeen: smallint('seasons_seen').notNull().default(0),
			// A finished season rolls into seasonsSeen, leaving one encoding per position.
			episodesIntoSeason: smallint('episodes_into_season').notNull().default(0),
			// The deletion clock follows completion, not the day the title was saved.
			watchedAt: timestamp('watched_at', { withTimezone: true }),
			addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
			updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
		},
		(t) => [
			unique('watchlist_item_user_media_unique').on(t.userId, t.mediaId),
			index('watchlist_item_media_id_idx').on(t.mediaId),
			check('watchlist_item_seasons_seen_check', sql`${t.seasonsSeen} >= 0`),
			check('watchlist_item_episodes_into_season_check', sql`${t.episodesIntoSeason} >= 0`)
		]
	)
	.enableRLS();

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
// The UI keeps the flattened read model while persistence is normalized.
export type WatchlistItem = typeof watchlistItem.$inferSelect &
	Omit<typeof media.$inferSelect, 'id' | 'createdAt' | 'updatedAt'>;
