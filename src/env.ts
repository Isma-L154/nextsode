import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Without these the app cannot serve a single page, so a missing one stops it
 * instead of failing query by query. A Worker has no startup phase: SvelteKit
 * validates the environment when the first request initializes the server.
 */
const required = (name: string) => (input: string | undefined) => {
	if (!input) throw new Error(`${name} is required`);
	return input;
};

/** Google sign-in switches off cleanly when it is not configured. */
const optional = (input: string | undefined) => input ?? '';

export const variables = defineEnvVars({
	TMDB_ACCESS_TOKEN: {
		description: 'TMDB v4 read access token (Bearer)',
		schema: required('TMDB_ACCESS_TOKEN')
	},
	GOOGLE_CLIENT_ID: { schema: optional },
	GOOGLE_CLIENT_SECRET: { schema: optional },
	OAUTH_ORIGIN: {
		description: 'Public origin for the OAuth redirect URI; empty derives it from the request',
		schema: optional
	}
});
