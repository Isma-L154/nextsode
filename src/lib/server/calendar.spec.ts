import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, seedUser, type TestDatabase } from './test-db';
import { user, watchlistItem } from './db/schema';

/**
 * The feed's server side, against a real database.
 *
 * This is the part with no session behind it: the request arrives from a
 * datacentre with no cookies, and the token in the URL is the only thing
 * deciding whose list comes back. Getting that wrong hands one person's
 * watchlist to another, so it is tested against a real engine and its real
 * unique index rather than a mock that would agree with whatever was written.
 */

let harness: TestDatabase;
vi.mock('./db', () => ({ getDb: () => harness.db }));

const { generateCalendarToken, issueCalendarToken, loadCalendarEntries, revokeCalendarToken } =
	await import('./calendar');

async function saveTitle(userId: string, over: Record<string, unknown> = {}) {
	await harness.db.insert(watchlistItem).values({
		userId,
		tmdbId: 1,
		mediaType: 'movie',
		title: 'Inception',
		releaseDate: '2026-09-15',
		...over
	});
}

beforeEach(async () => {
	harness = await createTestDatabase();
	await seedUser(harness.db);
	await seedUser(harness.db, { id: 'user-2', googleId: 'google-2', email: 'other@example.com' });
});

describe('generateCalendarToken', () => {
	it('is 256 bits of hex', () => {
		const token = generateCalendarToken();
		expect(token).toMatch(/^[0-9a-f]{64}$/);
	});

	it('does not repeat', () => {
		const tokens = new Set(Array.from({ length: 50 }, generateCalendarToken));
		expect(tokens.size).toBe(50);
	});
});

describe('issueCalendarToken', () => {
	it('stores the token it hands back', async () => {
		const token = await issueCalendarToken('user-1');
		const [row] = await harness.db
			.select({ calendarToken: user.calendarToken })
			.from(user)
			.where(eq(user.id, 'user-1'));

		expect(row.calendarToken).toBe(token);
	});

	it('replaces the previous token, breaking the old URL', async () => {
		const first = await issueCalendarToken('user-1');
		await saveTitle('user-1');
		const second = await issueCalendarToken('user-1');

		expect(second).not.toBe(first);
		// The entire point of "get a new link": the old one has to stop working.
		expect(await loadCalendarEntries(first)).toBeNull();
		expect(await loadCalendarEntries(second)).toHaveLength(1);
	});

	it('leaves other accounts alone', async () => {
		const mine = await issueCalendarToken('user-1');
		await issueCalendarToken('user-2');
		const [row] = await harness.db
			.select({ calendarToken: user.calendarToken })
			.from(user)
			.where(eq(user.id, 'user-1'));

		expect(row.calendarToken).toBe(mine);
	});
});

describe('revokeCalendarToken', () => {
	it('makes the feed unreadable', async () => {
		const token = await issueCalendarToken('user-1');
		await revokeCalendarToken('user-1');

		expect(await loadCalendarEntries(token)).toBeNull();
	});

	it('can be called on an account that never had one', async () => {
		await expect(revokeCalendarToken('user-2')).resolves.toBeUndefined();
	});
});

describe('loadCalendarEntries', () => {
	it('returns only the token owner’s titles', async () => {
		const mine = await issueCalendarToken('user-1');
		await saveTitle('user-1', { title: 'Mine' });
		await saveTitle('user-2', { title: 'Theirs', tmdbId: 2 });

		const entries = await loadCalendarEntries(mine);

		expect(entries?.map((e) => e.title)).toEqual(['Mine']);
	});

	it('answers null for a token nobody holds', async () => {
		await issueCalendarToken('user-1');

		// Indistinguishable from a revoked one, on purpose: a different answer
		// would confirm that a URL was once real.
		expect(await loadCalendarEntries('deadbeef'.repeat(8))).toBeNull();
	});

	it('will not match a row that somehow holds an empty token', async () => {
		// Nothing this code writes can produce an empty token, so the guard is
		// insurance against a future write path or a hand-edited row. Seeding one
		// directly is what makes it a guard rather than a comment: without the
		// early return, an empty request URL would open that account's feed.
		await harness.db.update(user).set({ calendarToken: '' }).where(eq(user.id, 'user-1'));

		expect(await loadCalendarEntries('')).toBeNull();
	});

	it('returns an empty list, not null, for an owner with nothing saved', async () => {
		const token = await issueCalendarToken('user-1');

		// A working subscription that will fill in later, rather than a 404 the
		// calendar client may stop retrying.
		expect(await loadCalendarEntries(token)).toEqual([]);
	});

	it('carries the fields an event is built from', async () => {
		const token = await issueCalendarToken('user-1');
		await saveTitle('user-1', {
			mediaType: 'tv',
			title: 'Silo',
			nextSeasonNumber: 3,
			nextSeasonAirDate: '2026-11-20'
		});

		expect((await loadCalendarEntries(token))?.[0]).toEqual({
			tmdbId: 1,
			title: 'Silo',
			mediaType: 'tv',
			releaseDate: '2026-09-15',
			nextSeasonNumber: 3,
			nextSeasonAirDate: '2026-11-20'
		});
	});
});
