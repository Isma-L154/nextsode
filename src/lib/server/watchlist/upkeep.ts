import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db';
import { watchlistItem } from '../db/schema';
import { clampSeasons, deriveWatched } from '$lib/domain/progress';
import { carryBookmark } from '$lib/domain/episodes';
import { isDueForDeletion, type DeletionWindow } from '$lib/domain/deletion';
import { resolveSeasonInfo } from './seasons';
import { watchedStamp } from './stamp';
import type { WatchlistRow } from './queries';

/**
 * Maintenance that runs while somebody is looking at their list.
 *
 * Doing it on read rather than on a schedule is what keeps the app free of a
 * cron job — and means the work only ever happens for lists somebody actually
 * opens. Order matters: seasons refresh first, then auto-deletion. The other way
 * round would delete the very show a new season was about to bring back.
 */

/**
 * How many rows one page load may re-resolve.
 *
 * Each repair costs a TMDB request, and they run in parallel, so this caps how
 * long a load can be held up by work the visitor never asked for. Lists converge
 * over a couple of visits, which is fine for background upkeep.
 */
const BACKFILL_BATCH_SIZE = 8;

/** Today as `YYYY-MM-DD` in UTC, matching how TMDB writes air dates. */
function todayIso(now: Date = new Date()): string {
	return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
		.toISOString()
		.slice(0, 10);
}

/**
 * Which rows need a trip to TMDB, and why.
 *
 * Two cases, resolved the same way. A show with no `airedSeasons` has never been
 * resolved — either it predates season tracking or its save-time lookup failed.
 * A show whose next season's air date has passed is stale in the way that
 * matters most: that season is watchable now, and until we notice, the viewer is
 * told they are still caught up.
 */
function needsSeasonRefresh(item: WatchlistRow, today: string): boolean {
	if (item.mediaType !== 'tv') return false;
	if (item.airedSeasons === null) return true;
	return item.nextSeasonAirDate !== null && item.nextSeasonAirDate <= today;
}

/**
 * Resolve season data for shows that need it, and return the list with those
 * rows patched.
 *
 * This is what makes the feature self-maintaining: it covers entries saved
 * before the columns existed, entries whose save-time lookup failed, and — the
 * ongoing case — shows that have since premiered a new season. When that last
 * one resolves, `airedSeasons` rises above `seasonsSeen`, `deriveWatched` turns
 * false, and the show reappears in "To watch" without anybody doing anything.
 */
export async function refreshSeasonData(items: WatchlistRow[]): Promise<WatchlistRow[]> {
	const today = todayIso();
	const pending = items
		.filter((item) => needsSeasonRefresh(item, today))
		.slice(0, BACKFILL_BATCH_SIZE);
	if (pending.length === 0) return items;

	const resolved = await Promise.all(
		pending.map(async (item) => ({ id: item.id, info: await resolveSeasonInfo(item.tmdbId) }))
	);

	const db = getDb();
	const patches = new Map<string, Partial<WatchlistRow>>();

	await Promise.all(
		resolved.map(async ({ id, info }) => {
			if (!info) return;

			const source = items.find((item) => item.id === id);
			if (!source) return;

			/**
			 * Progress is re-derived rather than left alone, because a newly aired
			 * season changes the answer: someone marked "watched" at 3 of 3 is no
			 * longer watched once a fourth is out. The seen count itself is never
			 * lowered by intent — only clamped when TMDB says those seasons are gone.
			 */
			const seasonsSeen = clampSeasons(source.seasonsSeen, info.airedSeasons);
			const watched = deriveWatched(seasonsSeen, info.airedSeasons);
			const patch = {
				totalSeasons: info.totalSeasons,
				airedSeasons: info.airedSeasons,
				nextSeasonNumber: info.nextSeasonNumber,
				nextSeasonAirDate: info.nextSeasonAirDate,
				...carryBookmark(source.seasonsSeen, seasonsSeen, source.episodesIntoSeason),
				watched,
				watchedAt: watchedStamp(watched, source.watchedAt)
			};

			patches.set(id, patch);
			await db.update(watchlistItem).set(patch).where(eq(watchlistItem.id, id));
		})
	);

	if (patches.size === 0) return items;

	// Patch the in-memory copy too, so the change shows up on this render rather
	// than only after the visitor happens to reload.
	return items.map((item) => (patches.has(item.id) ? { ...item, ...patches.get(item.id) } : item));
}

/**
 * Delete watched entries whose window has elapsed, returning the surviving list.
 *
 * The eligibility rules, including the one that spares any show with a season
 * still to come, live in `domain/deletion` where they are unit-tested. They are
 * the only thing standing between this statement and somebody's list, which is
 * why they live somewhere they can be tested without a database.
 *
 * The owner is passed rather than inferred, and the statement is scoped by it
 * even though `ids` already came from that account's own rows. Every other write
 * in this app carries that scope; a `delete` is the last place to start trusting
 * an id on its own.
 */
export async function deleteExpired(
	userId: string,
	items: WatchlistRow[],
	window: DeletionWindow | null
): Promise<WatchlistRow[]> {
	if (window === null) return items;

	const now = new Date();
	const due = items.filter((item) => isDueForDeletion(item, window, now));
	if (due.length === 0) return items;

	const ids = due.map((item) => item.id);
	await getDb()
		.delete(watchlistItem)
		.where(and(eq(watchlistItem.userId, userId), inArray(watchlistItem.id, ids)));

	const deleted = new Set(ids);
	return items.filter((item) => !deleted.has(item.id));
}
