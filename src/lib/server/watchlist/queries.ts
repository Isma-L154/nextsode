import { and, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import { withUser } from '../db/user';
import { media, watchlistItem } from '../db/schema';
import type { Database } from '../db';
import type { SessionUser } from '#lib/types.js';

/**
 * Reading a list. No writes here, and nothing that reaches for TMDB.
 */

/** The persistence join stays behind the existing, flattened read model. */
export function watchlistRows(db: Pick<Database, 'select'>) {
	return db
		.select({
			...getTableColumns(watchlistItem),
			tmdbId: media.tmdbId,
			mediaType: media.mediaType,
			title: media.title,
			posterPath: media.posterPath,
			releaseDate: media.releaseDate,
			overview: media.overview,
			voteAverage: media.voteAverage,
			totalSeasons: media.totalSeasons,
			airedSeasons: media.airedSeasons,
			nextSeasonNumber: media.nextSeasonNumber,
			nextSeasonAirDate: media.nextSeasonAirDate
		})
		.from(watchlistItem)
		.innerJoin(media, eq(watchlistItem.mediaId, media.id))
		.$dynamic();
}

/** The signed-in user's list, newest first. */
export async function loadWatchlist(user: SessionUser) {
	return withUser(user, async (tx) =>
		watchlistRows(tx).where(eq(watchlistItem.userId, user.id)).orderBy(desc(watchlistItem.addedAt))
	);
}
export type WatchlistRow = Awaited<ReturnType<typeof loadWatchlist>>[number];

/**
 * How many titles are still to watch, for the navigation badge.
 *
 * Not how many are saved. A badge is a number you are meant to act on, and
 * "everything you have ever finished" is not actionable: on a list that only
 * grows it climbs forever and stops meaning anything. This is the same set the
 * "To watch" tab shows, so tapping the badge lands on exactly the titles it
 * just counted.
 */
export async function countToWatch(user: SessionUser): Promise<number> {
	return withUser(user, async (tx) => {
		const [row] = await tx
			.select({ total: sql<string>`count(*)` })
			.from(watchlistItem)
			.where(and(eq(watchlistItem.userId, user.id), eq(watchlistItem.watched, false)));
		return Number(row?.total ?? 0);
	});
}

/**
 * One title's saved row for one user, or null when it is not on their list.
 *
 * For the title's public page, which has to decide between "Save" and "Remove"
 * without loading a whole list to answer a question about a single film. Scoped
 * by user id like every other read here: the page is public, the answer is not.
 */
export async function findSavedEntry(user: SessionUser, tmdbId: number, mediaType: 'movie' | 'tv') {
	return withUser(user, async (tx) => {
		const [row] = await tx
			.select({
				id: watchlistItem.id,
				watched: watchlistItem.watched,
				seasonsSeen: watchlistItem.seasonsSeen,
				episodesIntoSeason: watchlistItem.episodesIntoSeason,
				totalSeasons: media.totalSeasons,
				airedSeasons: media.airedSeasons
			})
			.from(watchlistItem)
			.innerJoin(media, eq(watchlistItem.mediaId, media.id))
			.where(
				and(
					eq(watchlistItem.userId, user.id),
					eq(media.tmdbId, tmdbId),
					eq(media.mediaType, mediaType)
				)
			)
			.limit(1);
		return row ?? null;
	});
}
