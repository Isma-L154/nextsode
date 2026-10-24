import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema.js';
import { deleteSessionCookie } from '#lib/server/auth.js';
import type { Actions } from './$types';

export const actions = {
	/**
	 * Delete the account and everything attached to it.
	 *
	 * It lives on this page on purpose: the promise and the button that keeps it
	 * belong together, and a right to erasure that requires emailing somebody is
	 * a right on paper only.
	 *
	 * One statement does all of it. Sessions and saved titles both reference the
	 * user row with `onDelete: cascade`, so removing it takes the list, the
	 * progress and every other session with it — no partial state, and nothing
	 * that can be missed by a second query that was never written.
	 */
	deleteAccount: async ({ locals, cookies }) => {
		if (!locals.user) return fail(401, { message: 'Please sign in first.' });

		await getDb().delete(user).where(eq(user.id, locals.user.id));

		// The row backing this cookie is already gone; clearing it stops the
		// browser presenting a token that can no longer resolve to anybody.
		deleteSessionCookie(cookies);

		redirect(303, '/?account=deleted');
	}
} satisfies Actions;
