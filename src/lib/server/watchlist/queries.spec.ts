import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, seedUser, type TestDatabase } from '../test-db';
import { watchlistItem } from '../db/schema';

/**
 * Reading somebody else's list.
 *
 * The mutations already have this covered — `actions.spec.ts` proves one
 * account cannot change another's row. Reads did not, and they are the half
 * that leaks rather than corrupts: a scoping mistake here hands over the list
 * silently, with nothing broken to notice afterwards.
 *
 * "Every query says `where userId`" is a claim about code. These are the tests
 * that make it a claim about behaviour, against a real engine, with a second
 * account's rows actually present to be returned by mistake.
 */

let harness: TestDatabase;
vi.mock('../db', () => ({ getDb: () => harness.db }));

const { countToWatch, loadWatchlist } = await import('./queries');

/** Both accounts, each with rows, so an unscoped query has something to leak. */
async function seedTwoAccounts() {
	await seedUser(harness.db, { id: 'alice', googleId: 'g-alice', email: 'alice@example.test' });
	await seedUser(harness.db, { id: 'bob', googleId: 'g-bob', email: 'bob@example.test' });

	await harness.db.insert(watchlistItem).values([
		{ userId: 'alice', tmdbId: 1, mediaType: 'movie', title: 'Alice One' },
		{ userId: 'alice', tmdbId: 2, mediaType: 'tv', title: 'Alice Two' },
		{ userId: 'bob', tmdbId: 3, mediaType: 'movie', title: 'Bob One' },
		{ userId: 'bob', tmdbId: 4, mediaType: 'tv', title: 'Bob Two' },
		{ userId: 'bob', tmdbId: 5, mediaType: 'movie', title: 'Bob Watched', watched: true }
	]);
}

beforeEach(async () => {
	harness = await createTestDatabase();
	await seedTwoAccounts();
});

describe('loadWatchlist', () => {
	it('returns only the asking account s titles', async () => {
		const titles = (await loadWatchlist('alice')).map((row) => row.title).sort();

		expect(titles).toEqual(['Alice One', 'Alice Two']);
	});

	it('returns nothing belonging to anyone else', async () => {
		const rows = await loadWatchlist('alice');

		expect(rows.every((row) => row.userId === 'alice')).toBe(true);
		expect(rows.map((row) => row.title)).not.toContain('Bob Watched');
	});

	it('gives each account its own list, not a shared one', async () => {
		const alice = (await loadWatchlist('alice')).map((r) => r.title);
		const bob = (await loadWatchlist('bob')).map((r) => r.title);

		expect(alice.some((t) => bob.includes(t))).toBe(false);
		expect(bob).toHaveLength(3);
	});

	it('answers an empty list for an id that owns nothing', async () => {
		// Not an error and not everybody's rows: the shape a caller expects when a
		// brand new account opens the page.
		await seedUser(harness.db, { id: 'carol', googleId: 'g-carol', email: 'c@example.test' });

		expect(await loadWatchlist('carol')).toEqual([]);
	});

	it('answers an empty list for an id that does not exist at all', async () => {
		// The value reaching here comes from a session lookup. If that ever returns
		// something unexpected, the failure must be "no rows", never "all rows".
		expect(await loadWatchlist('no-such-user')).toEqual([]);
		expect(await loadWatchlist('')).toEqual([]);
	});
});

describe('countToWatch', () => {
	it('counts only the asking account', async () => {
		expect(await countToWatch('alice')).toBe(2);
	});

	/**
	 * The badge is a number you are meant to act on, so a title you have already
	 * finished must not be in it. Bob owns three rows, one of them watched: a
	 * count that ignored the owner would read 5, and one that ignored `watched`
	 * would read 3.
	 */
	it('leaves watched titles out, and still only counts one account', async () => {
		expect(await countToWatch('bob')).toBe(2);
	});

	it('reaches zero for an account that has watched everything', async () => {
		await harness.db.update(watchlistItem).set({ watched: true });

		// Not "no rows" — the list is still full, there is just nothing left to do
		// with it, and the badge disappears rather than showing a stale number.
		expect(await countToWatch('alice')).toBe(0);
	});

	it('counts zero for an unknown id rather than everything', async () => {
		expect(await countToWatch('no-such-user')).toBe(0);
	});
});
