import { error } from '@sveltejs/kit';
import { buildCalendar } from '#lib/domain/calendar.js';
import { loadCalendarEntries } from '#lib/server/calendar.js';
import type { RequestHandler } from './$types';

/**
 * The subscribable feed.
 *
 * Authenticated by the token in the path and nothing else: the request comes
 * from Google's or Apple's fetcher, which has no cookies and no session. That
 * is why the route lives outside `/watchlist` and why every read below is
 * scoped by the row the token resolves to.
 */
export const GET: RequestHandler = async ({ params, url, setHeaders }) => {
	const entries = await loadCalendarEntries(params.token);

	// The same answer for a revoked token, a mistyped one and one that never
	// existed. Distinguishing them would confirm that a URL was once real.
	if (!entries) error(404, 'Not found');

	const body = buildCalendar(entries, { origin: url.origin });

	setHeaders({
		'content-type': 'text/calendar; charset=utf-8',
		// Named so a subscriber who downloads it by hand gets a recognisable file.
		'content-disposition': 'inline; filename="nextsode.ics"',
		/**
		 * Short and private. Calendar clients poll on their own schedule — Google
		 * in particular ignores every hint a feed can give — so caching this hard
		 * would only add our own delay on top of theirs. `private` keeps a shared
		 * proxy from holding one person's list.
		 */
		'cache-control': 'private, max-age=300',
		'x-robots-tag': 'noindex, nofollow'
	});

	return new Response(body);
};
