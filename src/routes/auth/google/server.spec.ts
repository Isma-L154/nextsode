import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from './$types';
import { createCodeChallenge } from '#lib/server/oauth-handshake.js';
import { STATE_COOKIE, VERIFIER_COOKIE } from '#lib/server/oauth.js';

vi.mock('$app/env/private', () => ({
	GOOGLE_CLIENT_ID: 'test-google-client-id',
	GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
	OAUTH_ORIGIN: ''
}));
vi.mock('#lib/server/rate-limit.js', () => ({ enforceRateLimit: vi.fn() }));

const { GET } = await import('./+server');

describe('Google OAuth start', () => {
	it('stores the state and verifier in protected cookies matching the authorization URL', async () => {
		const cookies = { set: vi.fn() };
		const requestEvent = {
			url: new URL('https://app.example.test/auth/google'),
			locals: { user: null },
			cookies
		} as unknown as RequestEvent;
		const result = await Promise.resolve(GET(requestEvent)).catch((error: unknown) => error);
		expect(result).toMatchObject({ status: 302, location: expect.any(String) });
		const url = new URL((result as { location: string }).location);
		expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
		const options = { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 };
		expect(cookies.set.mock.calls).toEqual([
			[STATE_COOKIE, expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), options],
			[VERIFIER_COOKIE, expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), options]
		]);
		const state = cookies.set.mock.calls[0][1] as string;
		const verifier = cookies.set.mock.calls[1][1] as string;
		expect(url.searchParams.get('state')).toBe(state);
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		expect(url.searchParams.get('code_challenge')).toBe(await createCodeChallenge(verifier));
	});
});
