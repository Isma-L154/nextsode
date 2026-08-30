import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { watchlistItem } from '../db/schema';

/**
 * Reading a list. No writes here, and nothing that reaches for TMDB.
 */

/** The signed-in user's list, newest first. */
export async function loadWatchlist(userId: string) {
	return getDb()
		.select()
		.from(watchlistItem)
		.where(eq(watchlistItem.userId, userId))
		.orderBy(desc(watchlistItem.addedAt));
}

export type WatchlistRow = Awaited<ReturnType<typeof loadWatchlist>>[number];

/**
 * How many titles are still to watch, for the navigation badge.
 *
 * Not how many are saved. A badge is a number you are meant to act on, and
 * "everything you have ever finished" is not actionable — on a list that only
 * grows it climbs forever and stops meaning anything. This is the same set the
 * "To watch" tab shows, so tapping the badge lands on exactly the titles it
 * just counted.
 */
export async function countToWatch(userId: string): Promise<number> {
	const [row] = await getDb()
		.select({ total: sql<number>`count(*)` })
		.from(watchlistItem)
		.where(and(eq(watchlistItem.userId, userId), eq(watchlistItem.watched, false)));
	return Number(row?.total ?? 0);
}
