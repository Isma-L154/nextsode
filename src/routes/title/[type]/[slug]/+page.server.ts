import { error, redirect } from '@sveltejs/kit';
import { getDetails } from '$lib/server/tmdb';
import { enforceRateLimit } from '$lib/server/rate-limit';
import { findSavedEntry, watchlistActions } from '$lib/server/watchlist';
import { parseTitleSlug, titleSlug } from '$lib/format/title-url';
import type { Actions, PageServerLoad } from './$types';

/**
 * One title, as a page anybody can open.
 *
 * The only route in the app that renders media without a session anywhere in
 * the picture, and it needs none: everything on it comes from TMDB, is the same
 * for every visitor, and says nothing about who linked to it. That is what makes
 * a share link here a plain URL rather than a token — there is no list behind
 * it to leak.
 *
 * Rendered on the server rather than fetched from the sheet's API, because the
 * two audiences for this page cannot run JavaScript on arrival: a crawler
 * indexing it, and the chat app unfurling it into a card. Both read the first
 * response and nothing after it.
 */
export const load: PageServerLoad = async (event) => {
	// The same ceiling the TMDB proxies carry, for the same reason: this route
	// spends the shared API quota and answers without a session, so it is
	// loopable by anybody who finds it.
	await enforceRateLimit(event);

	const { type, slug } = event.params;
	if (type !== 'movie' && type !== 'tv') error(404, 'Not found');

	const tmdbId = parseTitleSlug(slug);
	if (!tmdbId) error(404, 'Not found');

	// The visitor's country, resolved at the edge by the layout. Only the "where
	// to watch" band uses it; everything else on the page is the same worldwide.
	const { country } = await event.parent();

	const details = await getDetails(type, tmdbId, country, null).catch((err) => {
		console.error('TMDB details failed:', err);
		// 502 rather than 404: the title may well exist, and telling a crawler it
		// does not is a claim that outlives the outage that caused it.
		error(502, 'Could not load this title. Please try again.');
	});

	/**
	 * Send every other spelling of this id to the one canonical URL.
	 *
	 * A title gets renamed, or somebody edits the words in a pasted link, and the
	 * page still has to work — but it must not answer on two addresses, or the
	 * same film competes with itself in the index. 301 because this is permanent
	 * for the URL that was asked for; the id it redirects to never moves.
	 */
	const canonical = titleSlug(tmdbId, details.title);
	if (slug !== canonical) redirect(301, `/title/${type}/${canonical}`);

	/**
	 * Whether the visitor already has this one, so the page offers the action
	 * that is actually available. Signed out there is nothing to look up, and
	 * `SaveControl` renders the sign-in prompt instead.
	 */
	const saved = event.locals.user ? await findSavedEntry(event.locals.user.id, tmdbId, type) : null;

	return { details, saved };
};

/**
 * Saving from a public page writes to the visitor's own list, never the list of
 * whoever shared the link — which is not a rule enforced here so much as one
 * there is no way to break: every action below is scoped by the session.
 *
 * Only these two. The rest of the set edits progress on a row, which this page
 * deliberately does not show.
 */
export const actions: Actions = {
	add: watchlistActions.add,
	remove: watchlistActions.remove
};
