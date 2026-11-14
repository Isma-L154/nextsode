import { redirect } from '@sveltejs/kit';
import * as v from 'valibot';
import { sql } from 'drizzle-orm';
import { createSession, generateSessionToken, setSessionCookie } from '#lib/server/auth.js';
import { getDb } from '#lib/server/db/index.js';
import {
	STATE_COOKIE,
	VERIFIER_COOKIE,
	createGoogleClient,
	fetchGoogleProfile
} from '#lib/server/oauth.js';
import { enforceRateLimit } from '#lib/server/rate-limit.js';
import { parseFields } from '#lib/server/validation.js';
import type { RequestHandler } from './$types';

/**
 * Not strict, unlike every other schema here: Google appends parameters of its
 * own (`scope`, `authuser`, `prompt`), which are ignored rather than refused.
 */
const callbackQuery = v.object({
	code: v.pipe(v.string(), v.minLength(1), v.maxLength(2048)),
	state: v.pipe(v.string(), v.minLength(1), v.maxLength(256))
});

/**
 * Step 2 of the sign-in flow: Google redirects back here with an authorization
 * code, which we exchange for a profile and turn into a local session.
 *
 * Every failure path lands on `/?auth=error` rather than an error page: the
 * visitor can simply press the button again, and no internal detail leaks.
 */
export const GET: RequestHandler = async (event) => {
	await enforceRateLimit(event, 'AUTH_RATE_LIMIT');
	const { cookies, url } = event;
	const query = parseFields(callbackQuery, url.searchParams);
	const expectedState = cookies.get(STATE_COOKIE);
	const codeVerifier = cookies.get(VERIFIER_COOKIE);

	// Single-use by design: clear the handshake cookies before doing anything
	// else, so a replayed callback URL cannot be validated twice.
	cookies.delete(STATE_COOKIE, { path: '/' });
	cookies.delete(VERIFIER_COOKIE, { path: '/' });

	// A mismatching state means the request did not originate from our own
	// sign-in button — the standard OAuth CSRF check.
	if (!query || !expectedState || !codeVerifier || query.state !== expectedState) {
		redirect(302, '/?auth=error');
	}
	const { code } = query;

	try {
		const google = createGoogleClient(url.origin);
		const accessToken = await google.exchangeCode(code, codeVerifier);
		const profile = await fetchGoogleProfile(accessToken);

		const token = generateSessionToken();
		const expiresAt = await getDb().transaction(async (tx) => {
			const [row] = (
				await tx.execute<{ id: string }>(
					sql`select nextsode.sign_in_google(${profile.sub}, ${profile.email}, ${profile.name}, ${profile.picture}) as id`
				)
			).rows;
			return createSession(
				token,
				{ id: row.id, name: profile.name, email: profile.email, avatarUrl: profile.picture },
				tx
			);
		});
		setSessionCookie(cookies, token, expiresAt);
	} catch (err) {
		console.error('Google sign-in failed:', err);
		redirect(302, '/?auth=error');
	}

	redirect(302, '/');
};
