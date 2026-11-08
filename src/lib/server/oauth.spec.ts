import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCodeChallenge } from '#lib/server/oauth-handshake.js';
import { createGoogleClient, isGoogleAuthConfigured } from '#lib/server/oauth.js';

const env = vi.hoisted(() => ({
	GOOGLE_CLIENT_ID: 'test-google-client-id',
	GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
	OAUTH_ORIGIN: ''
}));
vi.mock('$app/env/private', () => env);

const ORIGIN = 'https://app.example.test/';
const CODE = 'test-authorization-code+/=&';
const VERIFIER = 'dBjftJeZ4CVP-mJ92IZ1kNpqLb0GMHQIaU4_KcGj0k8';
const INVALID_RESPONSE = 'Google token response is invalid';
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
	env.GOOGLE_CLIENT_ID = 'test-google-client-id';
	env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
	env.OAUTH_ORIGIN = '';
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

async function expectExchangeFailure(
	response: Response,
	expectedMessage: string,
	forbidden: string[] = []
) {
	fetchMock.mockResolvedValueOnce(response);
	const error = await createGoogleClient(ORIGIN)
		.exchangeCode(CODE, VERIFIER)
		.catch((error: unknown) => error);
	expect(error).toBeInstanceOf(Error);
	const message = (error as Error).message;
	expect(message).toBe(expectedMessage);
	for (const value of [env.GOOGLE_CLIENT_SECRET, CODE, VERIFIER, ...forbidden]) {
		expect(message).not.toContain(value);
	}
}

describe('createGoogleClient', () => {
	it('builds the Google authorization URL with S256 and the fixed scopes', async () => {
		const url = await createGoogleClient(ORIGIN).createAuthorizationUrl('test-state', VERIFIER);
		expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			response_type: 'code',
			client_id: env.GOOGLE_CLIENT_ID,
			redirect_uri: 'https://app.example.test/auth/google/callback',
			state: 'test-state',
			code_challenge_method: 'S256',
			code_challenge: await createCodeChallenge(VERIFIER),
			scope: 'openid profile email'
		});
		expect(url.toString()).not.toContain(env.GOOGLE_CLIENT_SECRET);
	});

	it('uses the configured origin for both halves of the handshake', async () => {
		env.OAUTH_ORIGIN = 'https://public.example.test/';
		const client = createGoogleClient(ORIGIN);
		const url = await client.createAuthorizationUrl('test-state', VERIFIER);
		fetchMock.mockResolvedValueOnce(Response.json({ access_token: 'test-access-token' }));
		await client.exchangeCode(CODE, VERIFIER);
		const request = new Request(...fetchMock.mock.calls[0]);
		const body = new URLSearchParams(await request.text());
		expect(url.searchParams.get('redirect_uri')).toBe(
			'https://public.example.test/auth/google/callback'
		);
		expect(body.get('redirect_uri')).toBe(url.searchParams.get('redirect_uri'));
	});

	it.each(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const)(
		'refuses to create a client without %s',
		(key) => {
			env[key] = '';
			expect(isGoogleAuthConfigured()).toBe(false);
			expect(() => createGoogleClient(ORIGIN)).toThrow(
				'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set'
			);
		}
	);
});

describe('exchangeCode', () => {
	it('posts all token fields as form data and authenticates only in the body', async () => {
		const client = createGoogleClient(ORIGIN);
		const url = await client.createAuthorizationUrl('test-state', VERIFIER);
		fetchMock.mockResolvedValueOnce(Response.json({ access_token: 'test-access-token' }));
		await expect(client.exchangeCode(CODE, VERIFIER)).resolves.toBe('test-access-token');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const request = new Request(...fetchMock.mock.calls[0]);
		expect(request.url).toBe('https://oauth2.googleapis.com/token');
		expect(request.method).toBe('POST');
		expect(request.headers.get('Accept')).toBe('application/json');
		expect(request.headers.get('Content-Type')).toContain('application/x-www-form-urlencoded');
		expect(request.headers.has('Authorization')).toBe(false);
		expect(Object.fromEntries(new URLSearchParams(await request.text()))).toEqual({
			grant_type: 'authorization_code',
			client_id: env.GOOGLE_CLIENT_ID,
			client_secret: env.GOOGLE_CLIENT_SECRET,
			code: CODE,
			redirect_uri: url.searchParams.get('redirect_uri'),
			code_verifier: VERIFIER
		});
	});

	it('accepts additional Google fields and returns only the access token', async () => {
		fetchMock.mockResolvedValueOnce(
			Response.json({
				access_token: 'test-access-token',
				expires_in: 3600,
				scope: 'openid profile email',
				token_type: 'Bearer',
				id_token: 'test-id-token'
			})
		);
		await expect(createGoogleClient(ORIGIN).exchangeCode(CODE, VERIFIER)).resolves.toBe(
			'test-access-token'
		);
	});

	it.each([1, 4096])('accepts an access token of %i characters', async (length) => {
		const token = 'a'.repeat(length);
		fetchMock.mockResolvedValueOnce(Response.json({ access_token: token }));
		await expect(createGoogleClient(ORIGIN).exchangeCode(CODE, VERIFIER)).resolves.toBe(token);
	});

	it('reports the HTTP status and an allowlisted Google error code', async () => {
		await expectExchangeFailure(
			Response.json({ error: 'invalid_grant' }, { status: 400 }),
			'Google token request failed with status 400 (invalid_grant)'
		);
	});

	it('does not expose response tokens, error descriptions or an unsafe error code', async () => {
		const unsafeError = `invalid_grant: ${env.GOOGLE_CLIENT_SECRET} ${CODE} ${VERIFIER}`;
		await expectExchangeFailure(
			Response.json(
				{
					error: unsafeError,
					error_description: 'private-error-description',
					access_token: 'private-access-token',
					id_token: 'private-id-token'
				},
				{ status: 400 }
			),
			'Google token request failed with status 400',
			[unsafeError, 'private-error-description', 'private-access-token', 'private-id-token']
		);
	});

	it.each(['', 'Invalid_grant', 'invalid-grant', 'invalid_grant1', 'a'.repeat(65), 123, null])(
		'ignores a disallowed error code: %j',
		async (error) => {
			await expectExchangeFailure(
				Response.json({ error }, { status: 400 }),
				'Google token request failed with status 400'
			);
		}
	);

	it.each(['a', 'a'.repeat(64)])(
		'accepts error codes at the length boundaries: %s',
		async (error) => {
			await expectExchangeFailure(
				Response.json({ error }, { status: 400 }),
				`Google token request failed with status 400 (${error})`
			);
		}
	);

	it('preserves the status error when Google returns HTML', async () => {
		const html = `<html>${env.GOOGLE_CLIENT_SECRET} ${CODE} ${VERIFIER}</html>`;
		await expectExchangeFailure(
			new Response(html, { status: 500, headers: { 'Content-Type': 'text/html' } }),
			'Google token request failed with status 500',
			[html]
		);
	});

	it('refuses even a successful status other than 200', async () => {
		await expectExchangeFailure(
			Response.json({ access_token: 'private-access-token' }, { status: 201 }),
			'Google token request failed with status 201',
			['private-access-token']
		);
	});

	it('rejects a non-JSON 200 without exposing the body', async () => {
		const body = `${env.GOOGLE_CLIENT_SECRET} ${CODE} ${VERIFIER}`;
		await expectExchangeFailure(new Response(body), INVALID_RESPONSE, [body]);
	});

	it.each([
		['missing', { id_token: 'private-id-token' }],
		['non-string', { access_token: 123 }],
		['empty', { access_token: '' }],
		['overlong', { access_token: 'a'.repeat(4097) }],
		['null', null],
		['array', [{ access_token: 'private-access-token' }]]
	])('rejects a %s access token response with the fixed message', async (_name, body) => {
		await expectExchangeFailure(Response.json(body), INVALID_RESPONSE, [
			'private-id-token',
			'private-access-token',
			'a'.repeat(4097)
		]);
	});
});
