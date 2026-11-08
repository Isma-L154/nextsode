import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from './$types';
import type * as OAuth from '#lib/server/oauth.js';
import { SESSION_COOKIE, validateSession } from '#lib/server/auth.js';
import { session, user } from '#lib/server/db/schema.js';
import { createTestDatabase, type TestDatabase } from '#lib/server/test-db.js';
import {
	STATE_COOKIE,
	VERIFIER_COOKIE,
	createGoogleClient,
	fetchGoogleProfile
} from '#lib/server/oauth.js';

vi.mock('$app/env/private', () => ({
	GOOGLE_CLIENT_ID: 'test-google-client-id',
	GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
	OAUTH_ORIGIN: ''
}));
vi.mock('#lib/server/rate-limit.js', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('#lib/server/oauth.js', async (importOriginal) => ({
	...(await importOriginal<typeof OAuth>()),
	createGoogleClient: vi.fn(),
	fetchGoogleProfile: vi.fn()
}));

let harness: TestDatabase;
vi.mock('#lib/server/db/index.js', () => ({ getDb: () => harness.db }));

const { GET } = await import('./+server');
const exchangeCode = vi.fn<(code: string, verifier: string) => Promise<string>>();
const STATE = 'test-state';
const VERIFIER = 'test-code-verifier';
const CODE = 'test-authorization-code';

function event(query: string, state: string | undefined, verifier: string | undefined) {
	const values = new Map([
		[STATE_COOKIE, state],
		[VERIFIER_COOKIE, verifier]
	]);
	const cookies = {
		get: vi.fn((name: string) => values.get(name)),
		set: vi.fn(),
		delete: vi.fn((name: string) => {
			values.delete(name);
		})
	};
	return {
		cookies,
		requestEvent: {
			url: new URL(`https://app.example.test/auth/google/callback?${query}`),
			cookies
		} as unknown as RequestEvent
	};
}

beforeEach(async () => {
	harness = await createTestDatabase();
	vi.clearAllMocks();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	exchangeCode.mockReset().mockResolvedValue('test-access-token');
	vi.mocked(createGoogleClient).mockReturnValue({
		createAuthorizationUrl: vi.fn(),
		exchangeCode
	});
	vi.mocked(fetchGoogleProfile).mockResolvedValue({
		sub: 'test-google-user',
		email: 'test@example.test',
		name: 'Test User',
		picture: null
	});
});

afterEach(() => {
	harness.client.close();
	vi.restoreAllMocks();
});

describe('Google OAuth callback', () => {
	it.each([
		{
			name: 'mismatching state',
			query: `code=${CODE}&state=other-state`,
			state: STATE,
			verifier: VERIFIER
		},
		{
			name: 'missing state cookie',
			query: `code=${CODE}&state=${STATE}`,
			state: undefined,
			verifier: VERIFIER
		},
		{
			name: 'missing verifier cookie',
			query: `code=${CODE}&state=${STATE}`,
			state: STATE,
			verifier: undefined
		},
		{
			name: 'Google refusal',
			query: `error=access_denied&state=${STATE}`,
			state: STATE,
			verifier: VERIFIER
		}
	])('rejects $name and clears both handshake cookies', async ({ query, state, verifier }) => {
		const { cookies, requestEvent } = event(query, state, verifier);
		await expect(GET(requestEvent)).rejects.toMatchObject({
			status: 302,
			location: '/?auth=error'
		});
		expect(cookies.delete.mock.calls).toEqual([
			[STATE_COOKIE, { path: '/' }],
			[VERIFIER_COOKIE, { path: '/' }]
		]);
		expect(exchangeCode).not.toHaveBeenCalled();
		expect(createGoogleClient).not.toHaveBeenCalled();
		expect(fetchGoogleProfile).not.toHaveBeenCalled();
		expect(cookies.set).not.toHaveBeenCalled();
		expect(await harness.db.select().from(session)).toHaveLength(0);
	});

	it('rejects a failed token exchange and clears both handshake cookies', async () => {
		exchangeCode.mockRejectedValueOnce(new Error('Google token request failed with status 400'));
		const { cookies, requestEvent } = event(`code=${CODE}&state=${STATE}`, STATE, VERIFIER);
		await expect(GET(requestEvent)).rejects.toMatchObject({
			status: 302,
			location: '/?auth=error'
		});
		expect(cookies.delete.mock.calls).toEqual([
			[STATE_COOKIE, { path: '/' }],
			[VERIFIER_COOKIE, { path: '/' }]
		]);
		expect(exchangeCode).toHaveBeenCalledExactlyOnceWith(CODE, VERIFIER);
		expect(fetchGoogleProfile).not.toHaveBeenCalled();
		expect(cookies.set).not.toHaveBeenCalled();
		expect(await harness.db.select().from(session)).toHaveLength(0);
	});

	it('exchanges the code, fetches the profile and creates a working session', async () => {
		const { cookies, requestEvent } = event(`code=${CODE}&state=${STATE}`, STATE, VERIFIER);
		await expect(GET(requestEvent)).rejects.toMatchObject({ status: 302, location: '/' });
		expect(exchangeCode).toHaveBeenCalledExactlyOnceWith(CODE, VERIFIER);
		expect(fetchGoogleProfile).toHaveBeenCalledExactlyOnceWith('test-access-token');
		expect(cookies.delete.mock.calls).toEqual([
			[STATE_COOKIE, { path: '/' }],
			[VERIFIER_COOKIE, { path: '/' }]
		]);
		expect(cookies.set).toHaveBeenCalledExactlyOnceWith(
			SESSION_COOKIE,
			expect.any(String),
			expect.objectContaining({
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				expires: expect.any(Date)
			})
		);
		const token = cookies.set.mock.calls[0][1] as string;
		expect(await validateSession(token)).toMatchObject({
			user: { name: 'Test User', email: 'test@example.test', avatarUrl: null }
		});
		expect(await harness.db.select().from(user)).toHaveLength(1);
	});
});
