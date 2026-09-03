import { index, integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

/**
 * A person who has signed in with Google.
 *
 * We deliberately store the bare minimum needed to render the account chip and
 * to recognise a returning visitor. No tokens from Google are persisted: the
 * OAuth access token is used once, during the callback, and then discarded.
 */
export const user = sqliteTable('user', {
	// Internal identifier, kept independent from Google's so the provider can be
	// swapped or extended later without rewriting every foreign key.
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),

	// Google's "sub" claim: stable forever, unlike the email address, which the
	// user can change. This is what we match on when someone signs in again.
	googleId: text('google_id').notNull().unique(),

	email: text('email').notNull(),
	name: text('name').notNull(),
	avatarUrl: text('avatar_url'),

	/**
	 * How many days a watched title stays on the list before it is deleted.
	 *
	 * Null means the feature is off, which is the default and stays the default:
	 * quietly clearing someone's list on their behalf is not a thing to opt them
	 * into, and this one does not keep a copy. See `domain/deletion` for what is
	 * eligible.
	 */
	autoDeleteDays: integer('auto_delete_days'),

	/**
	 * Secret that makes the calendar feed readable, or null when there is none.
	 *
	 * Opt-in: no token exists until somebody asks for one, and regenerating
	 * replaces it, which is what breaks every subscription made with the old URL.
	 *
	 * Stored as-is rather than hashed, unlike `session.id`, and the difference is
	 * deliberate. A session token is an authentication credential the browser
	 * already holds a copy of, so the database never needs to reproduce it. A
	 * feed URL has to be shown again — on the second device, a year later — and a
	 * hash cannot be shown. The trade is that a database leak exposes feed URLs;
	 * the mitigations are that the URL grants read-only access to one list and
	 * that it can be revoked from the UI.
	 */
	calendarToken: text('calendar_token').unique(),

	/**
	 * Secret that makes this list readable as a web page, or null when there is
	 * none.
	 *
	 * Same shape and same trade-offs as `calendarToken`, and deliberately not the
	 * same value: the two are handed to different audiences and have to be
	 * revocable apart. Turning off a link sent to one friend must not
	 * unsubscribe a calendar, and rolling the calendar over must not break a page
	 * somebody bookmarked.
	 *
	 * Stored as-is rather than hashed, for the reason spelled out above: a URL
	 * that has to be shown again cannot be a hash.
	 */
	shareToken: text('share_token').unique(),

	/**
	 * Which part of the list that token shows: `toWatch`, `watched` or `both`.
	 *
	 * Kept beside the token rather than encoded into it, so changing what is
	 * shared does not invalidate a link that has already been sent. Null means
	 * the same as no token — nothing is shared — and the column is only read
	 * once a token exists; see `domain/share` for the values and the default.
	 */
	shareScope: text('share_scope'),

	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

/**
 * An active browser session.
 *
 * `id` is the SHA-256 hash of the opaque token handed to the browser — never the
 * token itself. A leaked database therefore cannot be replayed as a valid
 * cookie, the same reasoning behind hashing passwords.
 */
export const session = sqliteTable(
	'session',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull()
	},
	(t) => [index('idx_session_user').on(t.userId)]
);

/**
 * A single movie or TV show on a user's list.
 *
 * TMDB is the source of truth for media metadata, but we persist a lightweight,
 * display-ready snapshot here so the list renders instantly without an extra
 * round-trip to the TMDB API on every page load.
 */
export const watchlistItem = sqliteTable(
	'watchlist_item',
	{
		// Internal, app-generated identifier (stable regardless of TMDB changes).
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		// Owner of the entry. Every read and write is scoped by this column, which
		// is what keeps one person's list invisible to everybody else.
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),

		// TMDB identity. The triple (userId, tmdbId, mediaType) uniquely identifies
		// a title within a list, preventing the same show from being saved twice —
		// while still allowing two different users to save the same title.
		tmdbId: integer('tmdb_id').notNull(),
		mediaType: text('media_type', { enum: ['movie', 'tv'] }).notNull(),

		// Cached metadata snapshot from TMDB.
		title: text('title').notNull(),
		posterPath: text('poster_path'),
		releaseDate: text('release_date'),
		overview: text('overview'),
		voteAverage: real('vote_average'),

		// User state.
		watched: integer('watched', { mode: 'boolean' }).notNull().default(false),

		/**
		 * TV progress: completed seasons, plus a bookmark inside the next one.
		 *
		 * Two integers rather than a row per episode, because series are watched in
		 * order and a position on a line is all that describes — no join table, no
		 * extra query on the list.
		 *
		 * `totalSeasons` is TMDB's count, snapshotted on save. Three states, all
		 * meaningful: a positive number is the real count, null means "not known
		 * yet" (every movie, plus any show still awaiting the read-path backfill),
		 * and 0 is the sentinel for "TMDB has no season data for this title" —
		 * which stops that backfill retrying forever. See `NO_SEASON_DATA`.
		 *
		 * `airedSeasons` is the one progress is measured against, and it is
		 * deliberately not the same number: TMDB counts announced seasons in its
		 * total, so a show with three aired seasons and a fourth dated for next
		 * year would otherwise be tickable to "fully watched" today.
		 *
		 * `nextSeasonNumber` / `nextSeasonAirDate` describe the next season still
		 * to premiere. The date is also what schedules the refresh: once it is in
		 * the past, the entry is re-read from TMDB, `airedSeasons` goes up, and the
		 * show drops back out of "watched" on its own.
		 */
		seasonsSeen: integer('seasons_seen').notNull().default(0),
		/**
		 * Episodes watched of the season *after* `seasonsSeen` — the bookmark.
		 *
		 * Always below that season's length: finishing the last episode rolls into
		 * `seasonsSeen` instead, so a given position has exactly one encoding. See
		 * `domain/episodes`.
		 */
		episodesIntoSeason: integer('episodes_into_season').notNull().default(0),
		totalSeasons: integer('total_seasons'),
		airedSeasons: integer('aired_seasons'),
		nextSeasonNumber: integer('next_season_number'),
		nextSeasonAirDate: text('next_season_air_date'),

		/**
		 * When the entry became watched.
		 *
		 * This is the clock auto-deletion runs on, so it is stamped on the
		 * transition into watched and cleared on the way out — `addedAt` cannot
		 * stand in for it, since when you saved something says nothing about when
		 * you got round to it. Tapping "Keep" restamps it, which is how a warning
		 * is answered without turning the feature off.
		 */
		watchedAt: integer('watched_at', { mode: 'timestamp' }),

		addedAt: integer('added_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		unique('uq_user_tmdb_media').on(t.userId, t.tmdbId, t.mediaType),
		index('idx_watchlist_user').on(t.userId)
	]
);

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
export type WatchlistItem = typeof watchlistItem.$inferSelect;
export type NewWatchlistItem = typeof watchlistItem.$inferInsert;
