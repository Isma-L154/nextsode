import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, seedUser, type TestDatabase } from './test-db';
import { session } from './db/schema';

/**
 * Sessions, against a real database.
 *
 * This is the file that decides who somebody is, and it had no tests. The
 * claims it makes are the kind that stay true by inspection right up until
 * they don't: that the database never holds the token the browser holds, that
 * an expired row cannot be presented as a login, and that renewal is lazy
 * enough not to write on every request.
 *
 * Each of those is a property of a stored row, so a mocked query builder would
 * only prove the code calls Drizzle the way it already calls Drizzle. The
 * engine is what answers them.
 */

let harness: TestDatabase;
vi.mock('./db', () => ({ getDb: () => harness.db }));

const { createSession, generateSessionToken, invalidateSession, validateSession, SESSION_COOKIE } =
	await import('./auth');

const DAY = 86_400_000;
const TTL = 30 * DAY;

/** Every stored session row, to inspect what a write actually left behind. */
const storedRows = () => harness.db.select().from(session);

/** Move a session's expiry to a chosen distance from now. */
async function expireIn(token: string, ms: number) {
	const [row] = await storedRows();
	await harness.db
		.update(session)
		.set({ expiresAt: new Date(Date.now() + ms) })
		.where(eq(session.id, row.id));
	return token;
}

beforeEach(async () => {
	harness = await createTestDatabase();
	await seedUser(harness.db, { id: 'alice', googleId: 'g-alice', email: 'alice@example.test' });
});

describe('generateSessionToken', () => {
	it('is 256 bits of hex', () => {
		expect(generateSessionToken()).toMatch(/^[0-9a-f]{64}$/);
	});

	it('does not repeat itself', () => {
		const tokens = new Set(Array.from({ length: 200 }, generateSessionToken));
		expect(tokens.size).toBe(200);
	});
});

describe('createSession', () => {
	/**
	 * The property the whole design rests on: a dump of this table is not enough
	 * to impersonate anybody, because the value the browser sends is not in it.
	 */
	it('stores a hash, never the token itself', async () => {
		const token = generateSessionToken();
		await createSession(token, 'alice');

		const [row] = await storedRows();
		expect(row.id).not.toBe(token);
		expect(row.id).toMatch(/^[0-9a-f]{64}$/);
		expect(row.userId).toBe('alice');
	});

	it('expires thirty days out', async () => {
		const expiresAt = await createSession(generateSessionToken(), 'alice');
		expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(TTL - 60_000);
		expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(TTL);
	});
});

describe('validateSession', () => {
	it('resolves a live token to its owner', async () => {
		const token = generateSessionToken();
		await createSession(token, 'alice');

		const result = await validateSession(token);

		expect(result?.user).toEqual({
			id: 'alice',
			name: 'Test User',
			email: 'alice@example.test',
			avatarUrl: null
		});
	});

	it('refuses a token that was never issued', async () => {
		expect(await validateSession(generateSessionToken())).toBeNull();
	});

	/**
	 * A token belonging to a deleted account must not resolve. The join is what
	 * enforces it — "delete my account" cascades the rows away, and a session
	 * left pointing at nothing has to fail closed rather than half-succeed.
	 */
	it('refuses a session whose account is gone', async () => {
		const token = generateSessionToken();
		await createSession(token, 'alice');
		await harness.client.execute("delete from user where id = 'alice'");

		expect(await validateSession(token)).toBeNull();
	});

	it('refuses an expired session and clears the row on sight', async () => {
		const token = generateSessionToken();
		await createSession(token, 'alice');
		await expireIn(token, -1000);

		expect(await validateSession(token)).toBeNull();
		expect(await storedRows()).toHaveLength(0);
	});

	/**
	 * Lazy renewal is what keeps an active visitor signed in without a write per
	 * request. Both halves matter: renewing too eagerly is the cost this avoids,
	 * and not renewing at all signs people out mid-use.
	 */
	it('leaves a fresh session alone', async () => {
		const token = generateSessionToken();
		await createSession(token, 'alice');
		const [before] = await storedRows();

		const result = await validateSession(token);

		expect(result?.renewed).toBe(false);
		const [after] = await storedRows();
		expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
	});

	it('extends a session past its halfway point', async () => {
		const token = generateSessionToken();
		await createSession(token, 'alice');
		await expireIn(token, DAY);

		const result = await validateSession(token);

		expect(result?.renewed).toBe(true);
		const [after] = await storedRows();
		expect(after.expiresAt.getTime() - Date.now()).toBeGreaterThan(TTL - 60_000);
		// Within a second of each other, not equal: the column is a unix timestamp
		// in seconds, so the stored value is the returned one with its milliseconds
		// dropped. The cookie therefore outlives the row by under a second.
		expect(result?.expiresAt.getTime() ?? 0).toBeGreaterThanOrEqual(after.expiresAt.getTime());
		expect((result?.expiresAt.getTime() ?? 0) - after.expiresAt.getTime()).toBeLessThan(1000);
	});
});

describe('invalidateSession', () => {
	it('revokes only the session it was given', async () => {
		const mine = generateSessionToken();
		const other = generateSessionToken();
		await createSession(mine, 'alice');
		await createSession(other, 'alice');

		await invalidateSession(mine);

		expect(await validateSession(mine)).toBeNull();
		expect(await validateSession(other)).not.toBeNull();
	});

	it('is silent about a token that does not exist', async () => {
		await expect(invalidateSession(generateSessionToken())).resolves.toBeUndefined();
	});
});

describe('SESSION_COOKIE', () => {
	// Renaming it signs every existing visitor out, so it is worth pinning.
	it('is the name the browser already holds', () => {
		expect(SESSION_COOKIE).toBe('wl_session');
	});
});
