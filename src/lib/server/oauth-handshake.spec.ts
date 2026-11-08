import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createCodeChallenge,
	generateCodeVerifier,
	generateState
} from '#lib/server/oauth-handshake.js';

afterEach(() => vi.restoreAllMocks());

describe('createCodeChallenge', () => {
	it('matches the RFC 7636 appendix B S256 vector', async () => {
		await expect(createCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).resolves.toBe(
			'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
		);
	});
});

describe.each([
	['generateState', generateState],
	['generateCodeVerifier', generateCodeVerifier]
] as const)('%s', (_name, generate) => {
	it('returns distinct 43-character base64url values without padding', () => {
		const first = generate();
		const second = generate();
		expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(first).not.toBe(second);
	});

	it('uses 32 cryptographically random bytes for each value', () => {
		const random = vi.spyOn(crypto, 'getRandomValues');
		generate();
		generate();
		expect(random).toHaveBeenCalledTimes(2);
		for (const [bytes] of random.mock.calls) {
			expect(bytes).toBeInstanceOf(Uint8Array);
			expect(bytes).toHaveLength(32);
		}
	});
});
