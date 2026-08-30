import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import {
	deleteExpired,
	loadWatchlist,
	refreshSeasonData,
	watchlistActions,
	type WatchlistRow
} from '$lib/server/watchlist';
import { normalizeDeletionWindow } from '$lib/domain/deletion';
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
		return { items: [] as WatchlistRow[], autoDeleteDays: null, calendarToken: null };
	}

	const [row] = await getDb()
		.select({ autoDeleteDays: user.autoDeleteDays, calendarToken: user.calendarToken })
		.from(user)
		.where(eq(user.id, locals.user.id))
		.limit(1);
	const autoDeleteDays = normalizeDeletionWindow(row?.autoDeleteDays);

	/**
	 * Two pieces of upkeep, both on the read path so there is no scheduled job to
	 * own. Season data is resolved first because auto-deletion reads it: a show
	 * that just gained a season must stop being eligible *before* the deletion
	 * rule looks at it, or being caught up would destroy the very title whose next
	 * season is now airing.
	 */
	const items = await deleteExpired(
		locals.user.id,
		await refreshSeasonData(await loadWatchlist(locals.user.id)),
		autoDeleteDays
	);

	/**
	 * The feed token reaches the browser deliberately: it is what the URL on
	 * screen is made of, and that URL has to be copyable onto a second device.
	 * It is only ever sent to its own owner — this loader returns nothing at all
	 * without a session.
	 */
	return { items, autoDeleteDays, calendarToken: row?.calendarToken ?? null };
};

export const actions: Actions = watchlistActions;
