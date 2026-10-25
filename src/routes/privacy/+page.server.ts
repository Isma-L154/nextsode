import { fail, redirect } from '@sveltejs/kit';
import * as v from 'valibot';
import { eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema.js';
import { deleteSessionCookie } from '#lib/server/auth.js';
import { INVALID_FORM, readForm } from '#lib/server/validation.js';
import type { Actions } from './$types';

/** The confirmation box is required here too, not only in the browser. */
const deleteAccountForm = v.strictObject({ confirm: v.literal('on') });

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
	deleteAccount: async ({ locals, cookies, request }) => {
		if (!locals.user) return fail(401, { message: 'Please sign in first.' });
		if (!(await readForm(request, deleteAccountForm))) return fail(400, INVALID_FORM);

		await getDb().delete(user).where(eq(user.id, locals.user.id));

		// The row backing this cookie is already gone; clearing it stops the
		// browser presenting a token that can no longer resolve to anybody.
		deleteSessionCookie(cookies);

		redirect(303, '/?account=deleted');
	}
} satisfies Actions;
