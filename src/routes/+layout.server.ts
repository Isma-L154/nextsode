import { resolveCountry } from '#lib/server/country.js';
import { isGoogleAuthConfigured } from '#lib/server/oauth.js';
import { countToWatch } from '#lib/server/watchlist/index.js';
import type { LayoutServerLoad } from './$types';

/**
 * Shell-level data: who is signed in, whether sign-in is even possible on this
 * deployment, and how many titles are still to watch.
 *
 * The count belongs here rather than on a page because the navigation badge is
 * part of the shell — it has to be right on Discover too, where the list itself
 * is never loaded. It is a single indexed `count(*)`, not a second fetch of the
 * list, and it re-runs on every enhanced form submission, which is what keeps
 * the badge honest the moment something is ticked off.
 */
export const load: LayoutServerLoad = async ({ locals, request, url }) => {
	return {
		user: locals.user,
		authAvailable: isGoogleAuthConfigured(),
		toWatchCount: locals.user ? await countToWatch(locals.user.id) : 0,
		country: resolveCountry(request),
		/**
		 * Where this deployment lives, for canonical URLs and share cards.
		 *
		 * Taken from the request rather than configured, so a move to a custom
		 * domain rewrites every one of them without a redeploy of settings — and so
		 * a preview deployment never claims the production URL as its canonical.
		 */
		origin: url.origin
	};
};
