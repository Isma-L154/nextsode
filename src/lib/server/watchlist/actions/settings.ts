import { fail, type Actions } from '@sveltejs/kit';
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { getDb } from '../../db';
import { user, watchlistItem } from '../../db/schema';
import { clip } from '../../form';
import { normalizeDeletionWindow } from '$lib/domain/deletion';
import { UNAUTHENTICATED, ownedRow } from './shared';

/**
 * Account-level choices about the list rather than edits to it: how long a
 * watched title survives, and the one-tap way to answer that countdown.
 */

export const settingsActions = {
	/**
	 * Choose how long a watched title stays before it is deleted, or turn the
	 * whole thing off.
	 *
	 * Anything that is not one of the offered windows is stored as null — "off" —
	 * rather than rejected, because the failure mode of a bad value here is
	 * someone's list emptying itself on a schedule they never picked.
	 *
	 * Picking a window also restarts the clock on anything already past it. The
	 * countdown is only half the feature; the other half is the week of warning
	 * the card shows before the end, and a title watched two months before you
	 * turned this on would run out the moment you did — deleted having never once
	 * said it was going to be. Under archiving that was survivable, because the
	 * title was still there to restore. It is not survivable now.
	 *
	 * So the window means "from here", and everything gets its full run. Turning
	 * the feature off touches nothing: there is no countdown to restart.
	 */
	setAutoDelete: async ({ request, locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);

		const form = await request.formData();
		const days = normalizeDeletionWindow(form.get('days'));

		const db = getDb();
		await db.update(user).set({ autoDeleteDays: days }).where(eq(user.id, locals.user.id));

		if (days !== null) {
			const now = new Date();
			await db
				.update(watchlistItem)
				.set({ watchedAt: now })
				.where(
					and(
						eq(watchlistItem.userId, locals.user.id),
						eq(watchlistItem.watched, true),
						isNotNull(watchlistItem.watchedAt),
						lt(watchlistItem.watchedAt, new Date(now.getTime() - days * 86_400_000))
					)
				);
		}

		return { autoDeleteDays: days };
	},

	/** Reset the deletion countdown for a title without changing anything else. */
	keepLonger: async ({ request, locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);

		const form = await request.formData();
		const id = clip(form.get('id'), 64);
		if (!id) return fail(400, { message: 'Missing id.' });

		await getDb()
			.update(watchlistItem)
			.set({ watchedAt: new Date() })
			.where(ownedRow(id, locals.user.id));

		return { kept: true };
	}
} satisfies Actions;
