import { desc, eq, sql } from 'drizzle-orm';
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

/** How many titles are saved, for the navigation badge. */
export async function countWatchlist(userId: string): Promise<number> {
	const [row] = await getDb()
		.select({ total: sql<number>`count(*)` })
		.from(watchlistItem)
		.where(eq(watchlistItem.userId, userId));
	return Number(row?.total ?? 0);
}
