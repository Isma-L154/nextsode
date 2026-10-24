import { redirect } from '@sveltejs/kit';
import { generateCodeVerifier, generateState } from 'arctic';
import {
	GOOGLE_SCOPES,
	HANDSHAKE_TTL_SECONDS,
	STATE_COOKIE,
	VERIFIER_COOKIE,
	createGoogleClient,
	isGoogleAuthConfigured
} from '#lib/server/oauth.js';
import type { RequestHandler } from './$types';

/**
 * Step 1 of the sign-in flow: send the visitor to Google's consent screen.
 *
 * Two short-lived cookies carry the CSRF `state` and the PKCE `code_verifier`
 * across the round-trip. Both are httpOnly and are checked (then cleared) by
 * the callback route.
 */
export const GET: RequestHandler = async ({ cookies, locals, url }) => {
	if (locals.user) redirect(302, '/');
	// Missing credentials is a deployment problem, not a visitor error — say so
	// on the home page instead of throwing a 500 at them.
	if (!isGoogleAuthConfigured()) redirect(302, '/?auth=unavailable');

	const google = createGoogleClient(url.origin);
	const state = generateState();
	const codeVerifier = generateCodeVerifier();
	const authorizationUrl = google.createAuthorizationURL(state, codeVerifier, GOOGLE_SCOPES);

	const options = {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: HANDSHAKE_TTL_SECONDS
	} as const;
	cookies.set(STATE_COOKIE, state, options);
	cookies.set(VERIFIER_COOKIE, codeVerifier, options);

	redirect(302, authorizationUrl.toString());
};
