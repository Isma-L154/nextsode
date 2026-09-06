import { fail, type Actions } from '@sveltejs/kit';
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { user, watchlistItem } from '../db/schema';
import { clip, toPositiveInt, toRating } from '../form';
import {
	clampSeasons,
	deriveWatched,
	normalizeAiredSeasons,
	normalizeTotalSeasons
} from '$lib/domain/progress';
import { resolveEpisodeTarget, seasonBoundary } from '$lib/domain/episodes';
import { normalizeDeletionWindow } from '$lib/domain/deletion';
import { canMarkWatched } from '$lib/domain/release';
import { resolveSeasonInfo, safeDetails, seasonInfoForSave } from './seasons';
import { watchedStamp } from './stamp';
import { issueCalendarToken, revokeCalendarToken } from '../calendar';
import { issueShareToken, revokeShareToken, setShareScope } from '../share';
import { scopeFromChoices } from '$lib/domain/share';
import type { MediaType } from '$lib/types';

/**
 * Every write a visitor can make to their own list.
 *
 * Both routes need these: Discover saves titles and My List edits them, and a
 * SvelteKit form action only exists on the route it is declared in. Rather than
 * two drifting copies, each `+page.server.ts` re-exports this one set.
 *
 * Two rules hold across all of them. Nothing is trusted from the browser except
 * intent — every bound is resolved here — and every statement is scoped by the
 * session's user id, because item ids travel through the browser as form fields
 * and knowing one must not be enough to use it.
 */

/** Returned by every action when the caller has no session. */
const UNAUTHENTICATED = { message: 'Please sign in first.' };

/**
 * Ceiling on how many titles one account may store.
 *
 * Far above any realistic list, but it stops a signed-in account from growing
 * the shared database without bound — the free Turso tier is a finite resource
 * shared by every user of the deployment.
 */
const MAX_ITEMS_PER_USER = 5000;

/**
 * Match a row by id *and* owner.
 *
 * The id alone would be enough to find the row, which is exactly the problem.
 * Someone else's id simply matches nothing.
 */
function ownedRow(id: string, userId: string) {
	return and(eq(watchlistItem.id, id), eq(watchlistItem.userId, userId));
}

/**
 * The scope the share form is asking for, or null when it names nothing.
 *
 * An unchecked box is absent from a form body rather than false, so presence is
 * the whole test. Both actions that write a scope read it through here, which is
 * what keeps "neither box ticked" one rule rather than two.
 */
function scopeFromShareForm(form: FormData) {
	return scopeFromChoices(form.has('toWatch'), form.has('watched'));
}

export const watchlistActions = {
	/** Save a movie/TV show. Duplicates are silently ignored via the unique index. */
	add: async ({ request, locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);

		const form = await request.formData();
		const tmdbId = toPositiveInt(form.get('tmdbId'));
		const mediaType = String(form.get('mediaType') ?? '') as MediaType;
		const title = clip(form.get('title'), 300);

		if (!tmdbId || (mediaType !== 'movie' && mediaType !== 'tv') || !title) {
			return fail(400, { message: 'Invalid item data.' });
		}

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
				posterPath: clip(form.get('posterPath'), 200),
				releaseDate: clip(form.get('releaseDate'), 10),
				overview: clip(form.get('overview'), 2000),
				voteAverage: toRating(form.get('voteAverage')),
				...(await seasonInfoForSave(mediaType, tmdbId))
			})
			// Backstop for two concurrent saves of the same title: the unique index
			// is the real guarantee, the check above is just the cheap fast path.
			.onConflictDoNothing();

		return { added: true };
	},

	/**
	 * Turn the calendar feed on, or roll it over.
	 *
	 * One action for both, because they are the same operation: a new token
	 * replaces whatever was there. Rolling over is how somebody takes back a URL
	 * that ended up somewhere it should not have, and it necessarily breaks every
	 * subscription made with the old one — which is the point, and which the UI
	 * says out loud before doing it.
	 */
	issueCalendarFeed: async ({ locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);
		await issueCalendarToken(locals.user.id);
		return { calendar: 'issued' as const };
	},

	/** Turn the calendar feed off, invalidating every subscription to it. */
	revokeCalendarFeed: async ({ locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);
		await revokeCalendarToken(locals.user.id);
		return { calendar: 'revoked' as const };
	},

	/**
	 * Turn the share link on, or roll it over.
	 *
	 * The scope arrives with the request rather than being assumed, because the
	 * two checkboxes and the button are one decision: nobody creates a link and
	 * then wonders what is on it. Neither box ticked is refused outright — there
	 * is no way to spell "share my list, showing nothing", and quietly picking a
	 * default here would publish something the owner did not tick.
	 */
	issueShareLink: async ({ request, locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);

		const scope = scopeFromShareForm(await request.formData());
		if (!scope) return fail(400, { message: 'Choose what to share first.' });

		await issueShareToken(locals.user.id, scope);
		return { share: 'issued' as const };
	},

	/**
	 * Change what the existing link shows, keeping the link itself.
	 *
	 * Separate from issuing on purpose. Widening a scope is not a request to
	 * break the URL already sent, and narrowing one only achieves anything if it
	 * is the same URL that starts showing less.
	 */
	updateShareScope: async ({ request, locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);

		const scope = scopeFromShareForm(await request.formData());
		if (!scope) return fail(400, { message: 'Choose what to share first.' });

		await setShareScope(locals.user.id, scope);
		return { share: 'updated' as const };
	},

	/** Turn the share link off, so every copy of the URL stops resolving. */
	revokeShareLink: async ({ locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);
		await revokeShareToken(locals.user.id);
		return { share: 'revoked' as const };
	},

	/** Remove an item from the list. */
	remove: async ({ request, locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);

		const form = await request.formData();
		const id = clip(form.get('id'), 64);
		if (!id) return fail(400, { message: 'Missing id.' });

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

		const form = await request.formData();
		const id = clip(form.get('id'), 64);
		if (!id) return fail(400, { message: 'Missing id.' });

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
	 * Choose how long a watched title stays before it is deleted, or turn the
	 * whole thing off.
	 *
	 * Anything that is not one of the offered windows is stored as null — "off" —
	 * rather than rejected, because the failure mode of a bad value here is
	 * someone's list emptying itself on a schedule they never picked.
	 *
	 * Picking a window also restarts the clock on anything already past it. The
	 * countdown is only half the feature; the other half is the week of warning
	 * the card shows before the end, and a title watched two months before you
	 * turned this on would run out the moment you did — deleted having never once
	 * said it was going to be. Under archiving that was survivable, because the
	 * title was still there to restore. It is not survivable now.
	 *
	 * So the window means "from here", and everything gets its full run. Turning
	 * the feature off touches nothing: there is no countdown to restart.
	 */
	setAutoDelete: async ({ request, locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);

		const form = await request.formData();
		const days = normalizeDeletionWindow(form.get('days'));

		const db = getDb();
		await db.update(user).set({ autoDeleteDays: days }).where(eq(user.id, locals.user.id));

		if (days !== null) {
			const now = new Date();
			await db
				.update(watchlistItem)
				.set({ watchedAt: now })
				.where(
					and(
						eq(watchlistItem.userId, locals.user.id),
						eq(watchlistItem.watched, true),
						isNotNull(watchlistItem.watchedAt),
						lt(watchlistItem.watchedAt, new Date(now.getTime() - days * 86_400_000))
					)
				);
		}

		return { autoDeleteDays: days };
	},

	/** Reset the deletion countdown for a title without changing anything else. */
	keepLonger: async ({ request, locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);

		const form = await request.formData();
		const id = clip(form.get('id'), 64);
		if (!id) return fail(400, { message: 'Missing id.' });

		await getDb()
			.update(watchlistItem)
			.set({ watchedAt: new Date() })
			.where(ownedRow(id, locals.user.id));

		return { kept: true };
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

		const form = await request.formData();
		const id = clip(form.get('id'), 64);
		const season = Number(form.get('season'));
		const episode = Number(form.get('episode'));

		if (!id) return fail(400, { message: 'Missing id.' });
		if (!Number.isInteger(season) || season < 1) return fail(400, { message: 'Invalid season.' });

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

		const form = await request.formData();
		const id = clip(form.get('id'), 64);
		const requested = Number(form.get('seasons'));
		if (!id) return fail(400, { message: 'Missing id.' });

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
