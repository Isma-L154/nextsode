import { desc, eq } from 'drizzle-orm';
import { getDb } from './db';
import { user, watchlistItem } from './db/schema';
import {
	normalizeShareScope,
	ownerFirstName,
	scopeIncludes,
	type ShareScope
} from '$lib/domain/share';

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
export async function issueShareToken(userId: string, scope: ShareScope): Promise<string> {
	const token = generateShareToken();
	await getDb()
		.update(user)
		.set({ shareToken: token, shareScope: scope })
		.where(eq(user.id, userId));
	return token;
}

/**
 * Change what an existing link shows, without changing the link.
 *
 * Deliberately not a re-issue: somebody who widens their scope has not asked to
 * break the URL they already sent, and somebody who narrows it wants the link
 * they sent to start showing less — which only works if it is the same link.
 */
export async function setShareScope(userId: string, scope: ShareScope): Promise<void> {
	await getDb().update(user).set({ shareScope: scope }).where(eq(user.id, userId));
}

/**
 * Take the link away.
 *
 * Every copy of the URL stops resolving, which is the undo for a link that went
 * further than intended. The scope is cleared with it so that a later link
 * starts from the default rather than silently inheriting a wider setting made
 * for a different audience.
 */
export async function revokeShareToken(userId: string): Promise<void> {
	await getDb().update(user).set({ shareToken: null, shareScope: null }).where(eq(user.id, userId));
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
 * Both halves of the list are read even when only one is shared, because the
 * page states the counts either way — "12 to watch" is the context that makes a
 * shared list legible, and it is a number, not a title.
 */
export async function loadSharedList(token: string): Promise<SharedList | null> {
	if (!token) return null;

	const db = getDb();
	const [owner] = await db
		.select({ id: user.id, name: user.name, scope: user.shareScope })
		.from(user)
		.where(eq(user.shareToken, token))
		.limit(1);

	if (!owner) return null;

	const scope = normalizeShareScope(owner.scope);

	const rows = await db
		.select({
			tmdbId: watchlistItem.tmdbId,
			mediaType: watchlistItem.mediaType,
			title: watchlistItem.title,
			posterPath: watchlistItem.posterPath,
			releaseDate: watchlistItem.releaseDate,
			voteAverage: watchlistItem.voteAverage,
			watched: watchlistItem.watched
		})
		.from(watchlistItem)
		.where(eq(watchlistItem.userId, owner.id))
		.orderBy(desc(watchlistItem.addedAt));

	return {
		ownerName: ownerFirstName(owner.name),
		scope,
		counts: {
			toWatch: rows.filter((row) => !row.watched).length,
			watched: rows.filter((row) => row.watched).length
		},
		// Filtered here rather than in SQL so the counts above describe the whole
		// list from the same read. Lists are capped at 5000 rows and typically hold
		// dozens; a second query to save a predicate would be the worse trade.
		items: rows.filter((row) => scopeIncludes(scope, row.watched))
	};
}

/** The current share settings for one account, for their own My List page. */
export async function loadShareSettings(userId: string) {
	const [row] = await getDb()
		.select({ token: user.shareToken, scope: user.shareScope })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	return {
		token: row?.token ?? null,
		// Only meaningful alongside a token; the panel reads it to tick the boxes.
		scope: normalizeShareScope(row?.scope)
	};
}
