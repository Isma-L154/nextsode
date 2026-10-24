import { eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { watchlistItem } from '#lib/server/db/schema.js';
import { getRecommendations, getTrending } from '#lib/server/tmdb/index.js';
import { watchlistActions } from '#lib/server/watchlist/index.js';
import { mediaKey } from '#lib/domain/media.js';
import {
	buildRails,
	dayNumber,
	pickSeeds,
	type RecommendationRail,
	type SeedCandidate
} from '#lib/domain/recommendations.js';
import type { MediaResult, SavedEntry } from '#lib/types.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * Discover: what to watch next.
 *
 * Trending is public — browsing works signed out — but everything derived from
 * the list is not: the saved-state overlay, and the suggestions built from it.
 *
 * The three run as concurrently as they can. Trending owes nothing to the
 * database, so it goes out immediately; the suggestions have to wait for the
 * rows that decide which titles to ask about, and then fan out in parallel.
 */
export const load: PageServerLoad = async ({ locals, request }) => {
	const rows = loadSavedRows(locals.user?.id);
	const today = dayNumber(new Date(), resolveTimeZone(request));

	const [saved, trending, recommendations] = await Promise.all([
		rows.then(buildSavedIndex),
		loadTrending(),
		rows.then((all) => loadRecommendations(all, today))
	]);

	return { saved, trending, recommendations };
};

/**
 * The viewer's own timezone, so the rows turn over at their midnight.
 *
 * Cloudflare resolves it at the edge alongside the country, so it costs nothing
 * and asks for no permission. Everywhere else — local development, the tests —
 * there is no edge to ask, and UTC is the honest default rather than a guess.
 */
function resolveTimeZone(request: Request): string {
	const zone = request.cf?.timezone;
	return typeof zone === 'string' && zone.length > 0 ? zone : 'UTC';
}

/** A saved row as this page reads it — the client only ever sees part of it. */
type SavedRow = SavedEntry & SeedCandidate;

/**
 * Every saved row, in one query.
 *
 * Two features read it: the saved-state overlay, and seed selection. The columns
 * they need barely overlap, but a second round-trip to Turso to fetch four more
 * columns of rows already in hand would cost more than carrying them.
 */
async function loadSavedRows(userId: string | undefined): Promise<SavedRow[]> {
	if (!userId) return [];

	return getDb()
		.select({
			id: watchlistItem.id,
			tmdbId: watchlistItem.tmdbId,
			mediaType: watchlistItem.mediaType,
			title: watchlistItem.title,
			watched: watchlistItem.watched,
			seasonsSeen: watchlistItem.seasonsSeen,
			episodesIntoSeason: watchlistItem.episodesIntoSeason,
			totalSeasons: watchlistItem.totalSeasons,
			airedSeasons: watchlistItem.airedSeasons,
			addedAt: watchlistItem.addedAt,
			watchedAt: watchlistItem.watchedAt
		})
		.from(watchlistItem)
		.where(eq(watchlistItem.userId, userId));
}

/**
 * The list as a lookup keyed by `"<tmdbId>:<mediaType>"`.
 *
 * Built on the server so the browser receives a ready-to-use index rather than
 * rebuilding it on every render. Every saved title has to be in it — search runs
 * client-side, so there is no way to know up front which ids a visitor will need
 * an answer for.
 *
 * That means the payload grows with the list, so it carries the six columns the
 * badge and the detail sheet actually read and nothing else: no title, no
 * timestamps, none of the columns seed selection needed. At a realistic couple
 * of hundred titles that is a few KB.
 */
function buildSavedIndex(rows: SavedRow[]): Record<string, SavedEntry> {
	return Object.fromEntries(
		rows.map((row) => [
			mediaKey(row),
			{
				id: row.id,
				watched: row.watched,
				seasonsSeen: row.seasonsSeen,
				episodesIntoSeason: row.episodesIntoSeason,
				totalSeasons: row.totalSeasons,
				airedSeasons: row.airedSeasons
			}
		])
	);
}

/**
 * Suggestions drawn from the list, as rows of "because you watched X".
 *
 * Signed-out visitors and empty lists cost nothing: with no seeds there is
 * nothing to ask, and the whole section simply does not render.
 *
 * `today` is what makes the rows turn over at midnight without anything having
 * to run at midnight: it changes which titles are asked about, and the answers
 * themselves are cached at the edge for a day.
 */
async function loadRecommendations(rows: SavedRow[], today: number): Promise<RecommendationRail[]> {
	const seeds = pickSeeds(rows, undefined, today);
	if (seeds.length === 0) return [];

	const results = await Promise.all(
		seeds.map(async (seed) => ({ seed, items: await safeRecommendations(seed) }))
	);

	return buildRails(results, new Set(rows.map(mediaKey)));
}

/**
 * Best-effort per seed: a failed lookup costs its own row, never the page. The
 * extra seed `pickSeeds` returns is what makes that cheap to absorb.
 */
async function safeRecommendations(seed: SeedCandidate): Promise<MediaResult[]> {
	try {
		return await getRecommendations(seed.mediaType, seed.tmdbId);
	} catch (err) {
		console.error('Failed to load recommendations for %s/%d:', seed.mediaType, seed.tmdbId, err);
		return [];
	}
}

/**
 * The first page of trending, rendered with the document.
 *
 * Further pages are fetched on demand from `/api/trending` when the visitor asks
 * for them, so the initial paint never pays for titles below the fold.
 *
 * Best-effort: a TMDB outage should degrade the page, not break it.
 */
async function loadTrending(): Promise<{ items: MediaResult[]; hasMore: boolean }> {
	try {
		const { results, hasMore } = await getTrending(1);
		return { items: results, hasMore };
	} catch (err) {
		console.error('Failed to load trending titles:', err);
		return { items: [], hasMore: false };
	}
}

// Discover needs `add` (and `remove`, so the detail modal can undo it), but the
// full set is re-exported: form actions resolve against the current route, and
// the modal is the same component on both pages.
export const actions: Actions = watchlistActions;
