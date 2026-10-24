import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Every variable is optional at startup and falls back to an empty string. The
 * modules that use them already throw a specific error when one they need is
 * missing, and Google sign-in is meant to switch off cleanly when it is not
 * configured rather than stop the whole app from booting.
 */
const optional = (input: string | undefined) => input ?? '';

export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'libSQL/Turso URL, or `file:` for a local SQLite file',
		schema: optional
	},
	DATABASE_AUTH_TOKEN: { description: 'Required when DATABASE_URL is remote', schema: optional },
	TMDB_ACCESS_TOKEN: { description: 'TMDB v4 read access token (Bearer)', schema: optional },
	GOOGLE_CLIENT_ID: { schema: optional },
	GOOGLE_CLIENT_SECRET: { schema: optional },
	OAUTH_ORIGIN: {
		description: 'Public origin for the OAuth redirect URI; empty derives it from the request',
		schema: optional
	}
});
