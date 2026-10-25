import { fail, type Actions } from '@sveltejs/kit';
import * as v from 'valibot';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { watchlistItem } from '../../db/schema';
import {
	INVALID_FORM,
	count,
	mediaType,
	optionalText,
	positiveInt,
	readForm,
	requiredText,
	rowId
} from '../../validation';
import {
	clampSeasons,
	deriveWatched,
	normalizeAiredSeasons,
	normalizeTotalSeasons
} from '#lib/domain/progress.js';
import { resolveEpisodeTarget, seasonBoundary } from '#lib/domain/episodes.js';
import { canMarkWatched } from '#lib/domain/release.js';
import { resolveSeasonInfo, safeDetails, seasonInfoForSave } from '../seasons';
import { watchedStamp } from '../stamp';
import { UNAUTHENTICATED, rowForm } from './shared';
import { ownedRow } from '../owned';

/**
 * The titles themselves: saving one, dropping one, and moving through it.
 *
 * Nothing is trusted from the browser except intent — every bound is resolved
 * here — and every statement is scoped by the session's user id.
 */

/**
 * Ceiling on how many titles one account may store.
 *
 * Far above any realistic list, but it stops a signed-in account from growing
 * the shared database without bound — the free Turso tier is a finite resource
 * shared by every user of the deployment.
 */
const MAX_ITEMS_PER_USER = 5000;

/**
 * What a save sends: the card's own snapshot of the title. The caps are
 * generous multiples of what TMDB returns, and a value past one is refused.
 * The descriptive fields may be empty or absent; TMDB does not always have them.
 */
const addForm = v.strictObject({
	tmdbId: positiveInt,
	mediaType,
	title: requiredText(300),
	posterPath: v.optional(
		v.union([v.literal(''), v.pipe(v.string(), v.regex(/^\/[\w.-]{1,100}$/))]),
		''
	),
	releaseDate: v.optional(v.union([v.literal(''), v.pipe(v.string(), v.isoDate())]), ''),
	overview: v.optional(optionalText(10_000), ''),
	voteAverage: v.optional(
		v.union([
			v.literal(''),
			v.pipe(v.string(), v.regex(/^\d{1,2}(\.\d{1,10})?$/), v.transform(Number), v.maxValue(10))
		]),
		''
	)
});

const episodeForm = v.strictObject({ id: rowId, season: positiveInt, episode: count });

const seasonsForm = v.strictObject({ id: rowId, seasons: count });

export const listActions = {
	/** Save a movie/TV show. Duplicates are silently ignored via the unique index. */
	add: async ({ request, locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);

		const input = await readForm(request, addForm);
		if (!input) return fail(400, { message: 'Invalid item data.' });
		const { tmdbId, mediaType, title } = input;

		const db = getDb();

		/**
		 * One query answers both guards: how full the list is, and whether this
		 * title is already on it. Checking for the duplicate up front also avoids
		 * spending a TMDB request on a save that would be discarded anyway.
		 */
		const [stats] = await db
			.select({
				total: sql<number>`count(*)`,
				duplicates: sql<number>`sum(case when ${watchlistItem.tmdbId} = ${tmdbId} and ${watchlistItem.mediaType} = ${mediaType} then 1 else 0 end)`
			})
			.from(watchlistItem)
			.where(eq(watchlistItem.userId, locals.user.id));

		if (Number(stats?.duplicates ?? 0) > 0) return { added: false };
		if (Number(stats?.total ?? 0) >= MAX_ITEMS_PER_USER) {
			return fail(400, { message: 'Your watchlist is full.' });
		}

		await db
			.insert(watchlistItem)
			.values({
				userId: locals.user.id,
				tmdbId,
				mediaType,
				title,
				posterPath: input.posterPath || null,
				releaseDate: input.releaseDate || null,
				overview: input.overview,
				voteAverage: input.voteAverage === '' ? null : input.voteAverage,
				...(await seasonInfoForSave(mediaType, tmdbId))
			})
			// Backstop for two concurrent saves of the same title: the unique index
			// is the real guarantee, the check above is just the cheap fast path.
			.onConflictDoNothing();

		return { added: true };
	},

	/** Remove an item from the list. */
	remove: async ({ request, locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);

		const input = await readForm(request, rowForm);
		if (!input) return fail(400, INVALID_FORM);
		const { id } = input;

		await getDb().delete(watchlistItem).where(ownedRow(id, locals.user.id));
		return { removed: true };
	},

	/**
	 * Toggle the watched/unwatched state of an item.
	 *
	 * For a season-tracked show this also moves the counter to the matching end,
	 * so progress and status can never contradict each other. Stepping back from
	 * "complete" lands on the previous season rather than zero: the user has still
	 * seen those seasons, and discarding that would be data loss.
	 */
	toggleWatched: async ({ request, locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);

		const input = await readForm(request, rowForm);
		if (!input) return fail(400, INVALID_FORM);
		const { id } = input;

		const db = getDb();
		const [item] = await db
			.select({
				title: watchlistItem.title,
				releaseDate: watchlistItem.releaseDate,
				watched: watchlistItem.watched,
				watchedAt: watchlistItem.watchedAt,
				totalSeasons: watchlistItem.totalSeasons,
				airedSeasons: watchlistItem.airedSeasons
			})
			.from(watchlistItem)
			.where(ownedRow(id, locals.user.id))
			.limit(1);
		if (!item) return fail(404, { message: 'Item not found.' });

		const watched = !item.watched;

		/**
		 * A title that is not out yet cannot be marked watched — the same rule the
		 * aired-seasons ceiling below already applies to shows, said once more for
		 * films. The card renders the release date instead of the button, so
		 * reaching here means a form body that was not built by that card.
		 *
		 * Only the way in is guarded. Un-watching stays open so a row saved before
		 * this rule, or one whose date TMDB has since moved outwards, is never
		 * stuck claiming something its owner cannot take back.
		 */
		if (watched && !canMarkWatched(item.releaseDate)) {
			return fail(400, { message: `“${item.title}” isn't out yet.` });
		}
		// Only aired seasons can be ticked off, so "mark watched" lands on the last
		// broadcast season rather than on an announced one.
		const ceiling = item.airedSeasons ?? item.totalSeasons;

		/**
		 * The toggle speaks in whole seasons, so the position lands on a season
		 * boundary — bookmark included. Without season data there is no counter to
		 * move and `seasonsSeen` is left exactly as it was: writing a zero there
		 * would erase progress on a show whose lookup simply has not resolved yet.
		 */
		const position = ceiling
			? seasonBoundary(watched ? ceiling : ceiling - 1)
			: { episodesIntoSeason: 0 };

		await db
			.update(watchlistItem)
			.set({
				watched,
				watchedAt: watchedStamp(watched, item.watchedAt),
				...position
			})
			.where(ownedRow(id, locals.user.id));

		return { toggled: true, watched };
	},

	/**
	 * Move the bookmark to "watched through season S, episode E".
	 *
	 * Absolute like `setSeasons`, so a double tap or a replayed request is
	 * idempotent. The season is always re-read from TMDB: episode counts and air
	 * dates are exactly the bounds the request is validated against, and a client
	 * does not get to define its own ceiling.
	 */
	setEpisode: async ({ request, locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);

		const input = await readForm(request, episodeForm);
		if (!input) return fail(400, INVALID_FORM);
		const { id, season, episode } = input;

		const db = getDb();
		const [item] = await db
			.select({
				tmdbId: watchlistItem.tmdbId,
				mediaType: watchlistItem.mediaType,
				watchedAt: watchlistItem.watchedAt,
				airedSeasons: watchlistItem.airedSeasons,
				totalSeasons: watchlistItem.totalSeasons
			})
			.from(watchlistItem)
			.where(ownedRow(id, locals.user.id))
			.limit(1);

		if (!item) return fail(404, { message: 'Item not found.' });
		if (item.mediaType !== 'tv') return fail(400, { message: 'Only TV shows track episodes.' });

		const details = await safeDetails(item.tmdbId, season);
		if (!details) return fail(502, { message: 'Could not reach TMDB. Please try again.' });

		const airedSeasons = normalizeAiredSeasons(details.airedSeasons) ?? item.airedSeasons;
		if (!airedSeasons || season > airedSeasons) {
			return fail(400, { message: 'That season has not aired yet.' });
		}

		const target = resolveEpisodeTarget(
			season,
			episode,
			details.episodeCounts[season] ?? null,
			details.season?.airedCount ?? null
		);

		const watched =
			deriveWatched(target.seasonsSeen, airedSeasons) && target.episodesIntoSeason === 0;

		await db
			.update(watchlistItem)
			.set({
				...target,
				airedSeasons,
				totalSeasons: normalizeTotalSeasons(details.seasons) ?? item.totalSeasons,
				nextSeasonNumber: details.upcomingSeason?.number ?? null,
				nextSeasonAirDate: details.upcomingSeason?.airDate ?? null,
				watched,
				watchedAt: watchedStamp(watched, item.watchedAt)
			})
			.where(ownedRow(id, locals.user.id));

		return {
			...target,
			airedSeasons,
			season,
			episodesWatched: target.episodesIntoSeason,
			seasonComplete: target.seasonsSeen >= season
		};
	},

	/**
	 * Set how many seasons of a show have been watched.
	 *
	 * The target is absolute rather than a delta, so a double submit or a replayed
	 * request is idempotent. The season *count* is always resolved server-side —
	 * the client sends only "how far I got", never the bounds it is measured
	 * against.
	 */
	setSeasons: async ({ request, locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);

		const input = await readForm(request, seasonsForm);
		if (!input) return fail(400, INVALID_FORM);
		const { id, seasons: requested } = input;

		const db = getDb();
		const [item] = await db
			.select({
				tmdbId: watchlistItem.tmdbId,
				mediaType: watchlistItem.mediaType,
				watchedAt: watchlistItem.watchedAt,
				totalSeasons: watchlistItem.totalSeasons,
				airedSeasons: watchlistItem.airedSeasons
			})
			.from(watchlistItem)
			.where(ownedRow(id, locals.user.id))
			.limit(1);

		if (!item) return fail(404, { message: 'Item not found.' });
		if (item.mediaType !== 'tv') return fail(400, { message: 'Only TV shows track seasons.' });

		/**
		 * Re-read from TMDB in exactly two situations: when nothing is stored (an
		 * entry that predates air-date tracking), and when this change would use up
		 * every aired season — the one moment where being stale is visible, because
		 * a season may have premiered since we last looked.
		 *
		 * Every other tap is a pure database write with no external call.
		 */
		const stored = item.airedSeasons;
		const shouldRefresh = stored === null || requested >= stored;
		const fresh = shouldRefresh ? await resolveSeasonInfo(item.tmdbId) : null;

		const airedSeasons = fresh?.airedSeasons ?? stored;
		if (!airedSeasons) return fail(400, { message: 'No season data available for this title.' });

		/**
		 * The clamp is the guard that matters: it is measured against *aired*
		 * seasons, so a request to tick off an announced season silently lands on the
		 * last one that actually exists instead of being honoured.
		 */
		const seasonsSeen = clampSeasons(requested, airedSeasons);
		const watched = deriveWatched(seasonsSeen, airedSeasons);

		// Only a fresh lookup may touch the descriptive columns — writing them from
		// a skipped one would blank the row with nulls it never learned.
		await db
			.update(watchlistItem)
			.set({
				// Named a season, so the position is that season's boundary.
				...seasonBoundary(seasonsSeen),
				airedSeasons,
				watched,
				watchedAt: watchedStamp(watched, item.watchedAt),
				...(fresh && {
					totalSeasons: fresh.totalSeasons,
					nextSeasonNumber: fresh.nextSeasonNumber,
					nextSeasonAirDate: fresh.nextSeasonAirDate
				})
			})
			.where(ownedRow(id, locals.user.id));

		return {
			seasonsSeen,
			airedSeasons,
			totalSeasons: fresh?.totalSeasons ?? item.totalSeasons
		};
	}
} satisfies Actions;
