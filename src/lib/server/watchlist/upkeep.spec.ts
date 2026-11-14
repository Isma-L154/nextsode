import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
	createTestDatabase,
	seedUser,
	seedItems,
	selectWatchlist,
	testUser,
	type ItemSeed,
	type TestDatabase
} from '../test-db';
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

/** TMDB's answer, stubbed. The network is not what is under test here. */
const details = vi.hoisted(() => vi.fn());
vi.mock('../tmdb', () => ({ getDetails: details }));

const { deleteExpired, refreshReleaseDates, refreshSeasonData } = await import('./upkeep');
const { loadWatchlist } = await import('./queries');

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

/** Insert a row and hand back the shape the read path would have loaded. */
async function saveTitle(userId: string, over: Partial<ItemSeed> = {}): Promise<WatchlistRow> {
	const [row] = await seedItems(harness.admin, {
		userId,
		tmdbId: Math.floor(Math.random() * 1_000_000),
		mediaType: 'movie',
		title: 'Arrival',
		releaseDate: '2016-11-11',
		watched: true,
		watchedAt: daysAgo(40),
		...over
	});
	return row;
}

/** Titles still in the database, whoever owns them. */
async function survivors(): Promise<string[]> {
	const rows = await selectWatchlist(harness.admin);
	return rows.map((row) => row.title).sort();
}

/** A date `days` from today, as TMDB writes them. */
function isoIn(days: number): string {
	return new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
}

beforeEach(async () => {
	harness = await createTestDatabase();
	await seedUser(harness.admin, {
		id: '00000000-0000-4000-8000-000000000001',
		googleId: 'g-alice',
		email: 'alice@example.test'
	});
	await seedUser(harness.admin, {
		id: '00000000-0000-4000-8000-000000000002',
		googleId: 'g-bob',
		email: 'bob@example.test'
	});
	details.mockReset();
});

describe('deleteExpired', () => {
	it('deletes nothing at all while the feature is off', async () => {
		const overdue = await saveTitle('00000000-0000-4000-8000-000000000001', {
			title: 'Arrival',
			watchedAt: daysAgo(999)
		});

		expect(
			await deleteExpired(testUser('00000000-0000-4000-8000-000000000001'), [overdue], null)
		).toEqual([overdue]);
		expect(await survivors()).toEqual(['Arrival']);
	});

	it('deletes an expired title and drops it from the returned list', async () => {
		const expired = await saveTitle('00000000-0000-4000-8000-000000000001', {
			title: 'Arrival',
			watchedAt: daysAgo(40)
		});

		expect(
			await deleteExpired(testUser('00000000-0000-4000-8000-000000000001'), [expired], 30)
		).toEqual([]);
		expect(await survivors()).toEqual([]);
	});

	it('leaves a title that is still inside its window', async () => {
		const fresh = await saveTitle('00000000-0000-4000-8000-000000000001', {
			title: 'Arrival',
			watchedAt: daysAgo(29)
		});
		const transaction = vi.spyOn(harness.db, 'transaction');

		expect(
			await deleteExpired(testUser('00000000-0000-4000-8000-000000000001'), [fresh], 30)
		).toEqual([fresh]);
		expect(transaction).not.toHaveBeenCalled();
		expect(await survivors()).toEqual(['Arrival']);
	});

	it('removes only the expired rows, leaving the rest of the list intact', async () => {
		const expired = await saveTitle('00000000-0000-4000-8000-000000000001', {
			title: 'Arrival',
			watchedAt: daysAgo(40)
		});
		const fresh = await saveTitle('00000000-0000-4000-8000-000000000001', {
			title: 'Dune',
			watchedAt: daysAgo(2)
		});
		const unwatched = await saveTitle('00000000-0000-4000-8000-000000000001', {
			title: 'Sinners',
			watched: false,
			watchedAt: null
		});

		const kept = await deleteExpired(
			testUser('00000000-0000-4000-8000-000000000001'),
			[expired, fresh, unwatched],
			30
		);

		expect(kept.map((row) => row.title)).toEqual(['Dune', 'Sinners']);
		expect(await survivors()).toEqual(['Dune', 'Sinners']);
	});

	/**
	 * The rule the whole design hangs on, restated against a database because
	 * this is the version that destroys the row rather than hiding it.
	 */
	it('never deletes a caught-up show with a season still to come', async () => {
		const waiting = await saveTitle('00000000-0000-4000-8000-000000000001', {
			title: 'Silo',
			mediaType: 'tv',
			watchedAt: daysAgo(999),
			nextSeasonNumber: 3,
			nextSeasonAirDate: '2099-01-01'
		});

		expect(
			await deleteExpired(testUser('00000000-0000-4000-8000-000000000001'), [waiting], 7)
		).toEqual([waiting]);
		expect(await survivors()).toEqual(['Silo']);
	});

	/**
	 * The ids handed to this function come from the caller's own list, so this is
	 * belt and braces — but a `delete` is the wrong place to rely on a caller
	 * getting it right, and an id travels through the browser on every other
	 * form on the page.
	 */
	it('cannot delete another account s row, even when handed it', async () => {
		const mine = await saveTitle('00000000-0000-4000-8000-000000000001', {
			title: 'Arrival',
			watchedAt: daysAgo(40)
		});
		const theirs = await saveTitle('00000000-0000-4000-8000-000000000002', {
			title: 'Bob Overdue',
			watchedAt: daysAgo(999)
		});

		await deleteExpired(testUser('00000000-0000-4000-8000-000000000001'), [mine, theirs], 30);

		expect(await survivors()).toEqual(['Bob Overdue']);
		const [row] = await selectWatchlist(harness.admin).where(eq(watchlistItem.id, theirs.id));
		expect(row.userId).toBe('00000000-0000-4000-8000-000000000002');
	});
});

describe('refreshReleaseDates', () => {
	/** What the row holds now. */
	const storedDate = async (id: string) =>
		(await selectWatchlist(harness.admin).where(eq(watchlistItem.id, id)))[0].releaseDate;

	it('asks about nothing when every title is already out', async () => {
		const out = await saveTitle('00000000-0000-4000-8000-000000000001', {
			releaseDate: '2016-11-11'
		});

		expect(
			await refreshReleaseDates(testUser('00000000-0000-4000-8000-000000000001'), [out])
		).toEqual([out]);
		expect(details).not.toHaveBeenCalled();
	});

	/**
	 * The case the whole function exists for: a film pulled forward. Without this
	 * the card keeps refusing "Watched" against a date that is no longer true,
	 * and the only way out is removing the title and saving it again.
	 */
	it('brings a title forward once TMDB moves it', async () => {
		const waiting = await saveTitle('00000000-0000-4000-8000-000000000001', {
			releaseDate: isoIn(400),
			watched: false
		});
		details.mockResolvedValue({ releaseDate: '2020-01-01' });

		const [patched] = await refreshReleaseDates(testUser('00000000-0000-4000-8000-000000000001'), [
			waiting
		]);

		expect(patched.releaseDate).toBe('2020-01-01');
		expect(await storedDate(waiting.id)).toBe('2020-01-01');
	});

	it('records a date that slipped further out', async () => {
		const waiting = await saveTitle('00000000-0000-4000-8000-000000000001', {
			releaseDate: isoIn(10),
			watched: false
		});
		details.mockResolvedValue({ releaseDate: isoIn(900) });

		const [patched] = await refreshReleaseDates(testUser('00000000-0000-4000-8000-000000000001'), [
			waiting
		]);

		expect(patched.releaseDate).toBe(isoIn(900));
	});

	// A date that was withdrawn is news; the row should stop claiming a day.
	it('records a date being withdrawn', async () => {
		const waiting = await saveTitle('00000000-0000-4000-8000-000000000001', {
			releaseDate: isoIn(30),
			watched: false
		});
		details.mockResolvedValue({ releaseDate: null });

		const [patched] = await refreshReleaseDates(testUser('00000000-0000-4000-8000-000000000001'), [
			waiting
		]);

		expect(patched.releaseDate).toBeNull();
		expect(await storedDate(waiting.id)).toBeNull();
	});

	/**
	 * Null from TMDB means "no answer", not "no date". Writing an absence over a
	 * date we already had would turn one failed request into a lost release.
	 */
	it('leaves the row alone when TMDB cannot be reached', async () => {
		const waiting = await saveTitle('00000000-0000-4000-8000-000000000001', {
			releaseDate: isoIn(30),
			watched: false
		});
		details.mockRejectedValue(new Error('network'));

		const [patched] = await refreshReleaseDates(testUser('00000000-0000-4000-8000-000000000001'), [
			waiting
		]);

		expect(patched.releaseDate).toBe(isoIn(30));
		expect(await storedDate(waiting.id)).toBe(isoIn(30));
	});

	// What keeps a list of patient titles from issuing a write per row on every
	// single page load.
	it('writes nothing when the date has not changed', async () => {
		const waiting = await saveTitle('00000000-0000-4000-8000-000000000001', {
			releaseDate: isoIn(30),
			watched: false
		});
		details.mockResolvedValue({ releaseDate: isoIn(30) });
		const transaction = vi.spyOn(harness.db, 'transaction');

		expect(
			await refreshReleaseDates(testUser('00000000-0000-4000-8000-000000000001'), [waiting])
		).toEqual([waiting]);
		expect(transaction).not.toHaveBeenCalled();
	});

	it('caps how many titles one page load re-asks about', async () => {
		const waiting = [];
		for (let i = 0; i < 12; i++) {
			waiting.push(
				await saveTitle('00000000-0000-4000-8000-000000000001', {
					releaseDate: isoIn(50 + i),
					watched: false
				})
			);
		}
		details.mockResolvedValue({ releaseDate: '2020-01-01' });

		await refreshReleaseDates(testUser('00000000-0000-4000-8000-000000000001'), waiting);

		expect(details.mock.calls.length).toBeLessThanOrEqual(8);
	});

	it('refreshes only titles loaded from the viewer s list under RLS', async () => {
		const mine = await saveTitle(testUser().id, {
			releaseDate: isoIn(30),
			watched: false
		});
		const theirs = await saveTitle('00000000-0000-4000-8000-000000000002', {
			releaseDate: isoIn(30),
			watched: false
		});
		details.mockResolvedValue({ releaseDate: '2020-01-01' });

		await refreshReleaseDates(testUser(), await loadWatchlist(testUser()));

		expect(await storedDate(mine.id)).toBe('2020-01-01');
		expect(await storedDate(theirs.id)).toBe(isoIn(30));
		expect(details).toHaveBeenCalledExactlyOnceWith('movie', mine.tmdbId);
	});
});

afterEach(async () => {
	vi.restoreAllMocks();
	await harness?.close();
});

describe('refreshSeasonData', () => {
	it('refreshes a shared title and reconciles each owner only inside their transaction', async () => {
		const mine = await saveTitle(testUser().id, {
			tmdbId: 99,
			mediaType: 'tv',
			totalSeasons: 4,
			airedSeasons: 3,
			nextSeasonNumber: 4,
			nextSeasonAirDate: '2020-01-01',
			seasonsSeen: 3
		});
		const bob = testUser('00000000-0000-4000-8000-000000000002');
		const theirs = await saveTitle(bob.id, {
			tmdbId: 99,
			mediaType: 'tv',
			totalSeasons: 4,
			airedSeasons: 3,
			nextSeasonNumber: 4,
			nextSeasonAirDate: '2020-01-01',
			seasonsSeen: 3
		});
		details.mockResolvedValue({ seasons: 4, airedSeasons: 4, upcomingSeason: null });
		const [patched] = await refreshSeasonData(testUser(), [mine]);
		expect(patched).toMatchObject({
			seasonsSeen: 3,
			airedSeasons: 4,
			watched: false,
			watchedAt: null
		});
		const [before] = await selectWatchlist(harness.admin).where(eq(watchlistItem.id, theirs.id));
		expect(before).toMatchObject({ airedSeasons: 4, watched: true });
		details.mockClear();
		const [caughtUp] = await refreshSeasonData(bob, await loadWatchlist(bob));
		expect(caughtUp).toMatchObject({
			seasonsSeen: 3,
			airedSeasons: 4,
			watched: false,
			watchedAt: null
		});
		expect(details).not.toHaveBeenCalled();
	});

	it('does not rewrite unchanged metadata or owner state', async () => {
		const item = await saveTitle(testUser().id, {
			mediaType: 'tv',
			watched: false,
			watchedAt: null,
			totalSeasons: 4,
			airedSeasons: 3,
			nextSeasonNumber: 4,
			nextSeasonAirDate: '2020-01-01'
		});
		const versions = async () => [
			...(
				await harness.admin.execute(
					sql`select xmin::text as version from nextsode.media where id = ${item.mediaId}::uuid union all select xmin::text from nextsode.watchlist_item where id = ${item.id}::uuid`
				)
			).rows
		];
		const before = await versions();
		const transaction = vi.spyOn(harness.db, 'transaction');
		details.mockResolvedValue({
			seasons: 4,
			airedSeasons: 3,
			upcomingSeason: { number: 4, airDate: '2020-01-01' }
		});
		expect(await refreshSeasonData(testUser(), [item])).toEqual([item]);
		expect(await versions()).toEqual(before);
		expect(transaction).not.toHaveBeenCalled();
	});

	it('preserves the plain watched toggle when TMDB has no season data', async () => {
		const item = await saveTitle(testUser().id, {
			mediaType: 'tv',
			watched: true,
			totalSeasons: 0,
			airedSeasons: 0
		});
		expect(await refreshSeasonData(testUser(), [item])).toEqual([item]);
		expect((await selectWatchlist(harness.admin))[0].watched).toBe(true);
	});
});
