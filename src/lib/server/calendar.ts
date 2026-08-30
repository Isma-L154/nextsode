import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { user, watchlistItem } from './db/schema';
import type { CalendarEntry } from '$lib/domain/calendar';

/**
 * The calendar feed's server side: minting the token that reads it, and the one
 * query that fills it.
 *
 * The token is the only credential involved. There is no session on a request
 * from Google's calendar fetcher — it arrives from a datacentre with no cookies
 * — so the URL has to carry the authority, and everything below is scoped by
 * the row that token resolves to.
 */

/**
 * A 256-bit token, the same size and generator as a session token.
 *
 * Guessing one is not a threat model at this width; the reason to keep it long
 * is that this URL will be pasted into calendar apps, shared screens and browser
 * histories, and it needs to survive being seen without being memorable.
 */
export function generateCalendarToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Give this account a feed, replacing any it already had. */
export async function issueCalendarToken(userId: string): Promise<string> {
	const token = generateCalendarToken();
	await getDb().update(user).set({ calendarToken: token }).where(eq(user.id, userId));
	return token;
}

/**
 * Take the feed away.
 *
 * Every existing subscription stops resolving, which is the entire point: this
 * is the undo for a URL that went somewhere it should not have.
 */
export async function revokeCalendarToken(userId: string): Promise<void> {
	await getDb().update(user).set({ calendarToken: null }).where(eq(user.id, userId));
}

/**
 * Everything the feed needs, in one query, for the owner of `token`.
 *
 * Returns null for a token that matches nothing — which the route answers with
 * a 404, the same answer it gives a token that never existed. A feed that said
 * "revoked" rather than "not found" would confirm the URL was once real.
 */
export async function loadCalendarEntries(token: string): Promise<CalendarEntry[] | null> {
	if (!token) return null;

	const db = getDb();
	const [owner] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.calendarToken, token))
		.limit(1);

	if (!owner) return null;

	return db
		.select({
			tmdbId: watchlistItem.tmdbId,
			title: watchlistItem.title,
			mediaType: watchlistItem.mediaType,
			releaseDate: watchlistItem.releaseDate,
			nextSeasonNumber: watchlistItem.nextSeasonNumber,
			nextSeasonAirDate: watchlistItem.nextSeasonAirDate
		})
		.from(watchlistItem)
		.where(eq(watchlistItem.userId, owner.id));
}
