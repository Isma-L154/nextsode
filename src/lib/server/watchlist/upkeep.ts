import { and, eq, inArray } from 'drizzle-orm';
import { withUser } from '../db/user';
import type { SessionUser } from '#lib/types.js';
import { media, watchlistItem } from '../db/schema';
import { clampSeasons, deriveWatched } from '#lib/domain/progress.js';
import { carryBookmark } from '#lib/domain/episodes.js';
import { isDueForDeletion, type DeletionWindow } from '#lib/domain/deletion.js';
import { isUpcoming } from '#lib/domain/release.js';
import { resolveSeasonInfo, type SeasonInfo } from './seasons';
import { resolveReleaseDate } from './releases';
import { watchedStamp } from './stamp';
import { ownedRow } from './owned';
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

function seasonChanges(source: WatchlistRow, fresh: SeasonInfo | null, now: Date) {
	// Another owner's refresh may already have advanced this shared title. Its
	// new ceiling must reconcile this owner's progress before auto-deletion.
	const info =
		fresh ??
		(source.mediaType === 'tv' && source.airedSeasons !== null && source.airedSeasons > 0
			? {
					totalSeasons: source.totalSeasons,
					airedSeasons: source.airedSeasons,
					nextSeasonNumber: source.nextSeasonNumber,
					nextSeasonAirDate: source.nextSeasonAirDate
				}
			: null);
	if (!info) return null;
	const metadataChanged =
		fresh !== null &&
		Object.entries(info).some(([key, value]) => source[key as keyof SeasonInfo] !== value);
	const seasonsSeen = clampSeasons(source.seasonsSeen, info.airedSeasons);
	const watched = deriveWatched(seasonsSeen, info.airedSeasons);
	const state = {
		...carryBookmark(source.seasonsSeen, seasonsSeen, source.episodesIntoSeason),
		watched,
		watchedAt:
			fresh || watched !== source.watched
				? watchedStamp(watched, source.watchedAt, now)
				: source.watchedAt
	};
	const stateChanged = Object.entries(state).some(([key, value]) => {
		const before = source[key as keyof typeof state];
		return before instanceof Date && value instanceof Date
			? before.getTime() !== value.getTime()
			: before !== value;
	});
	if (!metadataChanged && !stateChanged) return null;
	return {
		media: metadataChanged ? info : null,
		item: stateChanged ? state : null,
		row: { ...info, ...state }
	};
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
export async function refreshSeasonData(
	viewer: SessionUser,
	items: WatchlistRow[]
): Promise<WatchlistRow[]> {
	const now = new Date();
	const today = todayIso(now);
	const pending = [
		...new Map(
			items.filter((item) => needsSeasonRefresh(item, today)).map((item) => [item.mediaId, item])
		).values()
	].slice(0, BACKFILL_BATCH_SIZE);
	const resolved = new Map(
		await Promise.all(
			pending.map(async (item) => [item.mediaId, await resolveSeasonInfo(item.tmdbId)] as const)
		)
	);
	const patches = new Map<string, Partial<WatchlistRow>>();
	const mediaUpdates = new Map<string, SeasonInfo>();
	const itemUpdates: {
		id: string;
		patch: Pick<WatchlistRow, 'seasonsSeen' | 'episodesIntoSeason' | 'watched' | 'watchedAt'>;
	}[] = [];
	for (const source of items) {
		const change = seasonChanges(source, resolved.get(source.mediaId) ?? null, now);
		if (!change) continue;
		patches.set(source.id, change.row);
		if (change.media) mediaUpdates.set(source.mediaId, change.media);
		if (change.item) itemUpdates.push({ id: source.id, patch: change.item });
	}
	if (patches.size === 0) return items;
	await withUser(viewer, async (db) => {
		for (const [mediaId, patch] of mediaUpdates) {
			await db.update(media).set(patch).where(eq(media.id, mediaId));
		}
		for (const update of itemUpdates) {
			await db.update(watchlistItem).set(update.patch).where(ownedRow(update.id, viewer.id));
		}
	});
	return items.map((item) => (patches.has(item.id) ? { ...item, ...patches.get(item.id) } : item));
}

/**
 * Re-ask TMDB about titles that have not come out yet, and return the list with
 * those rows patched.
 *
 * Only rows still waiting are re-read, which is what bounds the work: once a
 * title is out its date stops being asked about forever, so this converges to
 * nothing for the great majority of a list. What it costs is one request per
 * title somebody is waiting on, and what it buys is that a date is never more
 * than one page load stale.
 *
 * That matters in three places, and it mattered in two of them before this rule
 * existed. "Watched" is withheld on this date, so a film pulled forward would
 * otherwise be untickable until it was removed and saved again. The Upcoming tab
 * groups by it. And the calendar feed publishes it into people's calendars,
 * where a slipped premiere becomes an appointment for a night with nothing on.
 *
 * Failures are non-fatal by construction: `resolveReleaseDate` answers null and
 * the row keeps the date it had.
 */
export async function refreshReleaseDates(
	viewer: SessionUser,
	items: WatchlistRow[]
): Promise<WatchlistRow[]> {
	const now = new Date();
	const pending = [
		...new Map(
			items.filter((item) => isUpcoming(item.releaseDate, now)).map((item) => [item.mediaId, item])
		).values()
	].slice(0, BACKFILL_BATCH_SIZE);
	const resolved = await Promise.all(
		pending.map(async (item) => ({
			item,
			answer: await resolveReleaseDate(item.mediaType, item.tmdbId)
		}))
	);
	const updates = resolved.flatMap(({ item, answer }) =>
		!answer || answer.releaseDate === item.releaseDate
			? []
			: [{ item, releaseDate: answer.releaseDate }]
	);
	if (updates.length === 0) return items;
	const patches = new Map(updates.map(({ item, releaseDate }) => [item.mediaId, releaseDate]));
	await withUser(viewer, async (db) => {
		for (const { item, releaseDate } of updates) {
			await db.update(media).set({ releaseDate }).where(eq(media.id, item.mediaId));
		}
	});
	return items.map((item) =>
		patches.has(item.mediaId) ? { ...item, releaseDate: patches.get(item.mediaId) ?? null } : item
	);
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
	viewer: SessionUser,
	items: WatchlistRow[],
	window: DeletionWindow | null
): Promise<WatchlistRow[]> {
	if (window === null) return items;

	const now = new Date();
	const due = items.filter((item) => isDueForDeletion(item, window, now));
	if (due.length === 0) return items;

	const ids = due.map((item) => item.id);
	await withUser(viewer, async (db) => {
		await db
			.delete(watchlistItem)
			.where(and(eq(watchlistItem.userId, viewer.id), inArray(watchlistItem.id, ids)));
	});

	const deleted = new Set(ids);
	return items.filter((item) => !deleted.has(item.id));
}
