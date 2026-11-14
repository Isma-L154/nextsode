import { eq, sql } from 'drizzle-orm';
import { getDb } from './db';
import { user } from './db/schema';
import { withUser } from './db/user';
import type { SessionUser } from '#lib/types.js';
import type { CalendarEntry } from '#lib/domain/calendar.js';

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
export async function issueCalendarToken(viewer: SessionUser): Promise<string> {
	const token = generateCalendarToken();
	await withUser(viewer, async (tx) => {
		await tx.update(user).set({ calendarToken: token }).where(eq(user.id, viewer.id));
	});
	return token;
}

/**
 * Take the feed away.
 *
 * Every existing subscription stops resolving, which is the entire point: this
 * is the undo for a URL that went somewhere it should not have.
 */
export async function revokeCalendarToken(viewer: SessionUser): Promise<void> {
	await withUser(viewer, async (tx) => {
		await tx.update(user).set({ calendarToken: null }).where(eq(user.id, viewer.id));
	});
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

	const rows = (
		await getDb().execute<{
			tmdb_id: number | null;
			title: string;
			media_type: 'movie' | 'tv';
			release_date: string | null;
			next_season_number: number | null;
			next_season_air_date: string | null;
		}>(
			sql`select tmdb_id, title, media_type, release_date::text, next_season_number, next_season_air_date::text from nextsode.calendar_entries(${token})`
		)
	).rows;
	if (rows.length === 0) return null;
	// A valid empty feed has one null title row, so it stays distinct from a 404.
	return rows
		.filter((row) => row.tmdb_id !== null)
		.map((row) => ({
			tmdbId: row.tmdb_id!,
			title: row.title,
			mediaType: row.media_type,
			releaseDate: row.release_date,
			nextSeasonNumber: row.next_season_number,
			nextSeasonAirDate: row.next_season_air_date
		}));
}
