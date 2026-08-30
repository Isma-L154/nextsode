import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, seedUser, type TestDatabase } from '../test-db';
import { watchlistItem } from '../db/schema';
import type { WatchlistRow } from './queries';

/**
 * Auto-deletion, against a real database.
 *
 * The eligibility rules are covered exhaustively in `domain/deletion`, and pure
 * functions are the right place for them. What cannot be tested there is the
 * half that touches a row: that the statement removes what the rules picked,
 * leaves everything else standing, and — the property that used to be free when
 * this feature only set a column — that it cannot reach outside one account.
 *
 * That last one is why these exist at all. Under archiving, a scoping mistake
 * hid somebody else's title. Now it destroys it.
 */

let harness: TestDatabase;
vi.mock('../db', () => ({ getDb: () => harness.db }));
vi.mock('../tmdb', () => ({ getDetails: vi.fn() }));

const { deleteExpired } = await import('./upkeep');

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

/** Insert a row and hand back the shape the read path would have loaded. */
async function saveTitle(
	userId: string,
	over: Partial<typeof watchlistItem.$inferInsert> = {}
): Promise<WatchlistRow> {
	const [row] = await harness.db
		.insert(watchlistItem)
		.values({
			userId,
			tmdbId: Math.floor(Math.random() * 1_000_000),
			mediaType: 'movie',
			title: 'Arrival',
			releaseDate: '2016-11-11',
			watched: true,
			watchedAt: daysAgo(40),
			...over
		})
		.returning();
	return row;
}

/** Titles still in the database, whoever owns them. */
async function survivors(): Promise<string[]> {
	const rows = await harness.db.select().from(watchlistItem);
	return rows.map((row) => row.title).sort();
}

beforeEach(async () => {
	harness = await createTestDatabase();
	await seedUser(harness.db, { id: 'alice', googleId: 'g-alice', email: 'alice@example.test' });
	await seedUser(harness.db, { id: 'bob', googleId: 'g-bob', email: 'bob@example.test' });
});

describe('deleteExpired', () => {
	it('deletes nothing at all while the feature is off', async () => {
		const overdue = await saveTitle('alice', { title: 'Arrival', watchedAt: daysAgo(999) });

		expect(await deleteExpired('alice', [overdue], null)).toEqual([overdue]);
		expect(await survivors()).toEqual(['Arrival']);
	});

	it('deletes an expired title and drops it from the returned list', async () => {
		const expired = await saveTitle('alice', { title: 'Arrival', watchedAt: daysAgo(40) });

		expect(await deleteExpired('alice', [expired], 30)).toEqual([]);
		expect(await survivors()).toEqual([]);
	});

	it('leaves a title that is still inside its window', async () => {
		const fresh = await saveTitle('alice', { title: 'Arrival', watchedAt: daysAgo(29) });

		expect(await deleteExpired('alice', [fresh], 30)).toEqual([fresh]);
		expect(await survivors()).toEqual(['Arrival']);
	});

	it('removes only the expired rows, leaving the rest of the list intact', async () => {
		const expired = await saveTitle('alice', { title: 'Arrival', watchedAt: daysAgo(40) });
		const fresh = await saveTitle('alice', { title: 'Dune', watchedAt: daysAgo(2) });
		const unwatched = await saveTitle('alice', {
			title: 'Sinners',
			watched: false,
			watchedAt: null
		});

		const kept = await deleteExpired('alice', [expired, fresh, unwatched], 30);

		expect(kept.map((row) => row.title)).toEqual(['Dune', 'Sinners']);
		expect(await survivors()).toEqual(['Dune', 'Sinners']);
	});

	/**
	 * The rule the whole design hangs on, restated against a database because
	 * this is the version that destroys the row rather than hiding it.
	 */
	it('never deletes a caught-up show with a season still to come', async () => {
		const waiting = await saveTitle('alice', {
			title: 'Silo',
			mediaType: 'tv',
			watchedAt: daysAgo(999),
			nextSeasonNumber: 3,
			nextSeasonAirDate: '2099-01-01'
		});

		expect(await deleteExpired('alice', [waiting], 7)).toEqual([waiting]);
		expect(await survivors()).toEqual(['Silo']);
	});

	/**
	 * The ids handed to this function come from the caller's own list, so this is
	 * belt and braces — but a `delete` is the wrong place to rely on a caller
	 * getting it right, and an id travels through the browser on every other
	 * form on the page.
	 */
	it('cannot delete another account s row, even when handed it', async () => {
		const mine = await saveTitle('alice', { title: 'Arrival', watchedAt: daysAgo(40) });
		const theirs = await saveTitle('bob', { title: 'Bob Overdue', watchedAt: daysAgo(999) });

		await deleteExpired('alice', [mine, theirs], 30);

		expect(await survivors()).toEqual(['Bob Overdue']);
		const [row] = await harness.db
			.select()
			.from(watchlistItem)
			.where(eq(watchlistItem.id, theirs.id));
		expect(row.userId).toBe('bob');
	});
});
