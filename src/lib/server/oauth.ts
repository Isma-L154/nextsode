import { Google } from 'arctic';
import { env } from '$env/dynamic/private';

/**
 * Google OAuth 2.0 / OpenID Connect wiring.
 *
 * Lives under `$lib/server`, so the client secret can never leak into the
 * browser bundle. `arctic` handles the protocol details (PKCE, token exchange);
 * everything here is configuration and profile mapping.
 */

/** Scopes requested at sign-in: identity only, nothing else. */
export const GOOGLE_SCOPES = ['openid', 'profile', 'email'];

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
	return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/**
 * Build the OAuth client for the current request.
 *
 * The redirect URI is derived from the incoming request origin so the same
 * build works on localhost, on preview URLs and in production. `OAUTH_ORIGIN`
 * overrides it for deployments that sit behind a proxy rewriting the Host
 * header (in which case `url.origin` would be the internal address).
 */
export function createGoogleClient(requestOrigin: string): Google {
	const clientId = env.GOOGLE_CLIENT_ID;
	const clientSecret = env.GOOGLE_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set');
	}

	const origin = (env.OAUTH_ORIGIN || requestOrigin).replace(/\/$/, '');
	return new Google(clientId, clientSecret, `${origin}${CALLBACK_PATH}`);
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
 * We call the endpoint rather than decoding the `id_token` locally: the token
 * arrives over a direct, authenticated TLS connection to Google, so this needs
 * no JWT signature verification and no key-rotation handling.
 */
export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
	const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
		headers: { Authorization: `Bearer ${accessToken}` }
	});

	if (!response.ok) {
		throw new Error(`Google userinfo request failed with status ${response.status}`);
	}

	const raw = (await response.json()) as {
		sub?: string;
		email?: string;
		name?: string;
		given_name?: string;
		picture?: string;
	};

	if (!raw.sub) throw new Error('Google userinfo response is missing "sub"');

	return {
		sub: raw.sub.slice(0, 128),
		email: (raw.email ?? '').slice(0, 320),
		// Fall back through the available name fields so the account chip is never
		// blank, even for profiles with unusual privacy settings.
		name: (raw.name || raw.given_name || raw.email?.split('@')[0] || 'Anonymous').slice(0, 120),
		picture: safeAvatarUrl(raw.picture)
	};
}

/**
 * Accept an avatar URL only if it is plain `https`.
 *
 * This value is stored and later rendered as an `<img src>`. Restricting the
 * scheme means a malformed or hostile response can never turn that attribute
 * into something other than an image fetch over TLS.
 */
function safeAvatarUrl(value: string | undefined): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' ? url.toString().slice(0, 500) : null;
	} catch {
		return null;
	}
}
