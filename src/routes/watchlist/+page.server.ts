import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import {
	deleteExpired,
	loadWatchlist,
	refreshReleaseDates,
	refreshSeasonData,
	watchlistActions,
	type WatchlistRow
} from '$lib/server/watchlist';
import { normalizeDeletionWindow } from '$lib/domain/deletion';
import { DEFAULT_SHARE_SCOPE, normalizeShareScope } from '$lib/domain/share';
import type { Actions, PageServerLoad } from './$types';

/**
 * My List: the saved titles and everything that can be done to them.
 *
 * Private by definition — with no session we return an empty list rather than
 * querying at all, and the page renders its signed-out state instead.
 */
export const load: PageServerLoad = async ({ locals }) => {
	// Typed rather than a bare `[]`: an untyped empty array widens the union the
	// page sees to `never[]`, which breaks inference on every helper downstream.
	if (!locals.user) {
		return {
			items: [] as WatchlistRow[],
			autoDeleteDays: null,
			calendarToken: null,
			shareToken: null,
			shareScope: DEFAULT_SHARE_SCOPE
		};
	}

	const [row] = await getDb()
		.select({
			autoDeleteDays: user.autoDeleteDays,
			calendarToken: user.calendarToken,
			shareToken: user.shareToken,
			shareScope: user.shareScope
		})
		.from(user)
		.where(eq(user.id, locals.user.id))
		.limit(1);
	const autoDeleteDays = normalizeDeletionWindow(row?.autoDeleteDays);

	/**
	 * Three pieces of upkeep, all on the read path so there is no scheduled job to
	 * own, and the order between them is load-bearing.
	 *
	 * Season data is resolved first because auto-deletion reads it: a show that
	 * just gained a season must stop being eligible *before* the deletion rule
	 * looks at it, or being caught up would destroy the very title whose next
	 * season is now airing.
	 *
	 * Release dates are re-asked next, and only for titles still waiting. That is
	 * what keeps "Watched" from being withheld on a date that has quietly moved —
	 * a film pulled forward would otherwise stay untickable until it was removed
	 * and saved again.
	 */
	const items = await deleteExpired(
		locals.user.id,
		await refreshReleaseDates(await refreshSeasonData(await loadWatchlist(locals.user.id))),
		autoDeleteDays
	);

	/**
	 * Both tokens reach the browser deliberately: they are what the URLs on
	 * screen are made of, and those URLs have to be copyable onto a second
	 * device. They are only ever sent to their own owner — this loader returns
	 * nothing at all without a session.
	 */
	return {
		items,
		autoDeleteDays,
		calendarToken: row?.calendarToken ?? null,
		shareToken: row?.shareToken ?? null,
		shareScope: normalizeShareScope(row?.shareScope)
	};
};

export const actions: Actions = watchlistActions;
