import * as v from 'valibot';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_ORIGIN } from '$app/env/private';
import { createCodeChallenge } from '#lib/server/oauth-handshake.js';

/**
 * Google OAuth 2.0 / OpenID Connect sign-in: the authorization-code flow
 * with PKCE, plus profile mapping.
 * Lives under `#lib/server`, so the client secret can never leak into the
 * browser bundle.
 */

/** Scopes requested at sign-in: identity only, nothing else. */
const GOOGLE_SCOPES = ['openid', 'profile', 'email'];
const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const tokenResponse = v.object({
	access_token: v.pipe(v.string(), v.minLength(1), v.maxLength(4096))
});
/**
 * The error code is allowlisted because it is copied into a message the
 * callback logs.
 */
const tokenErrorResponse = v.object({
	error: v.pipe(v.string(), v.regex(/^[a-z_]{1,64}$/))
});
const userinfoResponse = v.object({
	sub: v.pipe(v.string(), v.minLength(1), v.maxLength(255)),
	email: v.nullish(v.pipe(v.string(), v.maxLength(320))),
	name: v.nullish(v.string()),
	given_name: v.nullish(v.string()),
	picture: v.nullish(v.string())
});

/**
 * The Google sign-in handshake, keeping token response details inside the
 * client.
 */
export interface GoogleOAuthClient {
	createAuthorizationUrl(state: string, codeVerifier: string): Promise<URL>;
	/**
	 * Resolves to the access token. Errors omit the secret, code, verifier and
	 * response body because the callback logs them.
	 */
	exchangeCode(code: string, codeVerifier: string): Promise<string>;
}

/** Path Google redirects back to. Must be registered in the Google Console. */
const CALLBACK_PATH = '/auth/google/callback';

/**
 * Short-lived cookies that carry the handshake across the redirect to Google:
 * `state` proves the callback answers a request we started (CSRF), and the PKCE
 * `code_verifier` proves the code is being redeemed by the same client.
 */
export const STATE_COOKIE = 'google_oauth_state';
export const VERIFIER_COOKIE = 'google_code_verifier';

/** How long the user has to complete the Google consent screen. */
export const HANDSHAKE_TTL_SECONDS = 60 * 10;

/** True when the deployment has Google credentials configured. */
export function isGoogleAuthConfigured(): boolean {
	return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

/**
 * Build the OAuth client for the current request.
 *
 * The redirect URI is derived from the incoming request origin so the same
 * build works on localhost, on preview URLs and in production. `OAUTH_ORIGIN`
 * overrides it for deployments that sit behind a proxy rewriting the Host
 * header (in which case `url.origin` would be the internal address).
 */
export function createGoogleClient(requestOrigin: string): GoogleOAuthClient {
	const clientId = GOOGLE_CLIENT_ID;
	const clientSecret = GOOGLE_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set');
	}

	const origin = (OAUTH_ORIGIN || requestOrigin).replace(/\/$/, '');
	const redirectUri = `${origin}${CALLBACK_PATH}`;
	return {
		async createAuthorizationUrl(state, codeVerifier) {
			const url = new URL(AUTHORIZATION_ENDPOINT);
			url.search = new URLSearchParams({
				response_type: 'code',
				client_id: clientId,
				redirect_uri: redirectUri,
				state,
				code_challenge_method: 'S256',
				code_challenge: await createCodeChallenge(codeVerifier),
				scope: GOOGLE_SCOPES.join(' ')
			}).toString();
			return url;
		},
		async exchangeCode(code, codeVerifier) {
			const response = await fetch(TOKEN_ENDPOINT, {
				method: 'POST',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/x-www-form-urlencoded'
				},
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					client_id: clientId,
					client_secret: clientSecret,
					code,
					redirect_uri: redirectUri,
					code_verifier: codeVerifier
				})
			});

			const raw: unknown = await response.json().catch(() => null);
			if (response.status !== 200) {
				const result = v.safeParse(tokenErrorResponse, raw);
				const suffix = result.success ? ` (${result.output.error})` : '';
				throw new Error(`Google token request failed with status ${response.status}${suffix}`);
			}

			const result = v.safeParse(tokenResponse, raw);
			if (!result.success) throw new Error('Google token response is invalid');
			return result.output.access_token;
		}
	};
}

/** The subset of Google's OIDC userinfo response that we actually use. */
export interface GoogleProfile {
	sub: string;
	email: string;
	name: string;
	picture: string | null;
}

/**
 * Read the signed-in person's profile from Google's OIDC userinfo endpoint.
 *
 * We call the endpoint rather than decoding the `id_token` locally: the profile
 * arrives over a direct, authenticated TLS connection to Google, so this needs
 * no JWT signature verification and no key-rotation handling.
 * Errors omit the access token and response body because the callback logs them.
 */
export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
	const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
		headers: { Authorization: `Bearer ${accessToken}` }
	});

	if (response.status !== 200) {
		throw new Error(`Google userinfo request failed with status ${response.status}`);
	}

	const raw: unknown = await response.json().catch(() => null);
	const result = v.safeParse(userinfoResponse, raw);
	if (!result.success) throw new Error('Google userinfo response is invalid');
	const profile = result.output;

	// Fall back through available names so the account chip is never blank,
	// even for profiles with unusual privacy settings. Cap this display label,
	// never the account identifier.
	const name = profile.name || profile.given_name || profile.email?.split('@')[0] || 'Anonymous';

	return {
		sub: profile.sub,
		email: profile.email ?? '',
		name: name.slice(0, 120),
		picture: safeAvatarUrl(profile.picture)
	};
}

/**
 * Accept only a normalized HTTPS avatar URL of at most 500 characters.
 *
 * This value is stored and later rendered as an `<img src>`. Restricting the
 * scheme means a malformed or hostile response can never turn that attribute
 * into something other than an image fetch over TLS.
 */
function safeAvatarUrl(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		const normalized = url.toString();
		return url.protocol === 'https:' && normalized.length <= 500 ? normalized : null;
	} catch {
		return null;
	}
}
