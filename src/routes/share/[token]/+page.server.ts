import { error } from '@sveltejs/kit';
import { loadSharedList } from '$lib/server/share';
import type { PageServerLoad } from './$types';

/**
 * Somebody's list, opened by a stranger.
 *
 * Authenticated by the token in the path and nothing else — the visitor has no
 * session, and requiring one would defeat the point of the link. That is why
 * this route lives outside `/watchlist` and why the read below is scoped
 * entirely by the row the token resolves to.
 *
 * A signed-in visitor is not treated differently here. Their own session says
 * nothing about whether they may read this list; the URL is the only thing that
 * does, and it is the same page either way.
 */
export const load: PageServerLoad = async ({ params, setHeaders }) => {
	/**
	 * Set before the lookup, so they hold whether or not a list is found.
	 *
	 * Every response from this path is one of two private things — somebody's
	 * list, or the fact that a token does not resolve — and neither is a page for
	 * an index or a shared cache to keep. Setting them after the 404 would leave
	 * the miss uncovered, which is the response an unissued token gets, and so
	 * the one a crawler following a stale link would see.
	 */
	setHeaders({
		/**
		 * Never cached by anything shared, and never indexed.
		 *
		 * The page is public in the sense that it needs no password, not in the
		 * sense that it is for everybody: it was sent to particular people, and a
		 * proxy holding a copy or a crawler filing one would put a private list
		 * somewhere its owner cannot revoke it from. `robots.txt` says the same
		 * thing, and so does the `noindex` on the page — three layers, because a
		 * mistake here is not recoverable by deleting the token.
		 */
		'cache-control': 'private, no-store',
		'x-robots-tag': 'noindex, nofollow'
	});

	const list = await loadSharedList(params.token);

	// The same answer for a revoked token, a mistyped one and one that never
	// existed. Distinguishing them would confirm that a URL was once real.
	if (!list) error(404, 'Not found');

	return { list };
};
