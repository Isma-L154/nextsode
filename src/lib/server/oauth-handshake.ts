/**
 * Values carried across the redirect: CSRF state, the PKCE verifier and its
 * S256 challenge (RFC 7636).
 */

/** A fresh CSRF state for a single sign-in attempt. */
export function generateState(): string {
	return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** A fresh PKCE verifier kept in the handshake cookie until code redemption. */
export function generateCodeVerifier(): string {
	return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The RFC 7636 S256 challenge sent to the provider instead of the verifier. */
export async function createCodeChallenge(codeVerifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
	return base64url(new Uint8Array(digest));
}

/**
 * RFC 7636 section 4.1 allows only unreserved characters, so padding is
 * omitted; 32 random bytes give its 43-character minimum.
 */
function base64url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}
