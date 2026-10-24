import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, deleteSessionCookie, invalidateSession } from '#lib/server/auth.js';
import type { RequestHandler } from './$types';

/**
 * Sign out. POST-only so it cannot be triggered by a stray link, an image tag
 * or a prefetch; SvelteKit's built-in CSRF origin check covers the form post.
 */
export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE);
	if (token) {
		try {
			await invalidateSession(token);
		} catch (err) {
			// Even if the row survives, dropping the cookie signs this browser out.
			console.error('Failed to invalidate session:', err);
		}
	}

	deleteSessionCookie(cookies);
	redirect(303, '/');
};
