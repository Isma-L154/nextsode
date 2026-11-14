import { eq, sql } from 'drizzle-orm';
import { getDb } from './db';
import { user } from './db/schema';
import { withUser } from './db/user';
import type { SessionUser } from '#lib/types.js';
import { ownerFirstName, type ShareScope } from '#lib/domain/share.js';

/**
 * The shared list's server side: minting the token that reads it, and the one
 * query that fills it.
 *
 * The token is the only credential involved, exactly as with the calendar feed:
 * the request arrives from a browser that has never signed in, so the URL has
 * to carry the authority, and everything below is scoped by the row it resolves
 * to.
 *
 * What is different from the feed is that this one is read by a person rather
 * than a fetcher, which is why the query below returns a name and counts as
 * well as rows — the page has to say whose list it is.
 */

/**
 * A 256-bit token, the same size and generator as a session and a feed token.
 *
 * Guessing one is not a threat model at this width. The reason to keep it long
 * is that this URL gets pasted into chats and read off shared screens, and it
 * needs to survive being seen without being memorable — a short token invites
 * somebody to try the one next to it.
 */
export function generateShareToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Give this account a share link, replacing any it already had.
 *
 * One call for both "create" and "roll over", because they are the same
 * operation. Rolling over necessarily breaks every link already sent, which is
 * the entire point of offering it — and which the UI says out loud first.
 */
export async function issueShareToken(viewer: SessionUser, scope: ShareScope): Promise<string> {
	const token = generateShareToken();
	await withUser(viewer, async (tx) => {
		await tx
			.update(user)
			.set({ shareToken: token, shareScope: scope })
			.where(eq(user.id, viewer.id));
	});
	return token;
}

/**
 * Change what an existing link shows, without changing the link.
 *
 * Deliberately not a re-issue: somebody who widens their scope has not asked to
 * break the URL they already sent, and somebody who narrows it wants the link
 * they sent to start showing less — which only works if it is the same link.
 */
export async function setShareScope(viewer: SessionUser, scope: ShareScope): Promise<void> {
	await withUser(viewer, async (tx) => {
		await tx.update(user).set({ shareScope: scope }).where(eq(user.id, viewer.id));
	});
}

/**
 * Take the link away.
 *
 * Every copy of the URL stops resolving, which is the undo for a link that went
 * further than intended. The scope is cleared with it so that a later link
 * starts from the default rather than silently inheriting a wider setting made
 * for a different audience.
 */
export async function revokeShareToken(viewer: SessionUser): Promise<void> {
	await withUser(viewer, async (tx) => {
		await tx.update(user).set({ shareToken: null, shareScope: null }).where(eq(user.id, viewer.id));
	});
}

/** Everything the public page renders, for the owner of one token. */
export interface SharedList {
	/**
	 * The owner's first name, and never more.
	 *
	 * Reduced here rather than in the page, so the full name a Google account
	 * carries does not leave the server at all. A component that wanted to print
	 * a surname would have nothing to print it from.
	 */
	ownerName: string;
	scope: ShareScope;
	/** How the whole list divides, so the page can say what it is not showing. */
	counts: { toWatch: number; watched: number };
	items: SharedItem[];
}

/**
 * One title on a shared list.
 *
 * A deliberately short row. It carries what a poster needs and what a link to
 * the title's public page needs, and nothing that belongs to the owner: no row
 * id, no user id, no timestamps. Whoever opens the link gets a reading of a
 * list, not a handle on it.
 */
export interface SharedItem {
	tmdbId: number;
	mediaType: 'movie' | 'tv';
	title: string;
	posterPath: string | null;
	releaseDate: string | null;
	voteAverage: number | null;
	watched: boolean;
}

/**
 * The shared list behind `token`, or null when the token matches nothing.
 *
 * Null covers a revoked token, a mistyped one and one that never existed, and
 * the route answers all three with the same 404. Distinguishing them would
 * confirm that a URL was once real, which is exactly what somebody probing a
 * forwarded link is trying to learn.
 *
 * Counts describe both halves, while SQL returns titles only for the shared
 * scope. The page states the counts either way — "12 to watch" is the context that makes a
 * shared list legible, and it is a number, not a title.
 */
export async function loadSharedList(token: string): Promise<SharedList | null> {
	if (!token) return null;

	const rows = (
		await getDb().execute<{
			owner_name: string;
			scope: ShareScope;
			to_watch_count: string | number;
			watched_count: string | number;
			tmdb_id: number | null;
			media_type: 'movie' | 'tv';
			title: string;
			poster_path: string | null;
			release_date: string | null;
			vote_average: number | null;
			watched: boolean;
		}>(
			sql`select owner_name, scope, to_watch_count, watched_count, tmdb_id, media_type, title, poster_path, release_date::text, vote_average, watched from nextsode.shared_list(${token})`
		)
	).rows;
	const first = rows[0];
	if (!first) return null;
	return {
		ownerName: ownerFirstName(first.owner_name),
		scope: first.scope,
		counts: { toWatch: Number(first.to_watch_count), watched: Number(first.watched_count) },
		items: rows
			.filter((row) => row.tmdb_id !== null)
			.map((row) => ({
				tmdbId: row.tmdb_id!,
				mediaType: row.media_type,
				title: row.title,
				posterPath: row.poster_path,
				releaseDate: row.release_date,
				voteAverage: row.vote_average,
				watched: row.watched
			}))
	};
}
