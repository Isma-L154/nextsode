import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Database } from '../db';
import * as schema from '../db/schema';
import { testDatabaseUrl } from '../test-db-setup';
import type { RequestEvent } from '@sveltejs/kit';
import {
	createTestDatabase,
	seedUser,
	seedItems,
	selectWatchlist,
	testUser,
	type ItemSeed,
	type TestDatabase
} from '../test-db';
import { user, watchlistItem } from '../db/schema';
import type { MediaDetails } from '#lib/types.js';

/**
 * The form actions, against a real database.
 *
 * This is where every bug found by hand has actually lived. The domain layer is
 * pure and exhaustively covered; the actions are where that logic meets a row,
 * and "the write forgot a column" is a defect no amount of domain testing can
 * see.
 */

let harness: TestDatabase;

const connections = vi.hoisted(() => ({ next: [] as Database[] }));
vi.mock('../db', () => ({ getDb: () => connections.next.shift() ?? harness.db }));

/** TMDB's answer, stubbed. The network is not what is under test here. */
const details = vi.hoisted(() => vi.fn());
vi.mock('../tmdb', () => ({ getDetails: details }));

/** The per-account limiter, stubbed to allow unless a test says otherwise. */
const isRateLimited = vi.hoisted(() => vi.fn(async () => false));
vi.mock('../rate-limit', () => ({ isRateLimited, TOO_MANY_REQUESTS: 'Too many requests.' }));

const { watchlistActions } = await import('./actions');

/** A show with three aired seasons of ten episodes, and no fourth announced. */
function showDetails(over: Partial<MediaDetails> = {}): MediaDetails {
	return {
		tmdbId: 1,
		mediaType: 'tv',
		title: 'Silo',
		overview: null,
		tagline: null,
		genres: [],
		releaseDate: '2023-05-05',
		runtimeMinutes: null,
		seasons: 3,
		airedSeasons: 3,
		upcomingSeason: null,
		nextEpisode: null,
		episodeCounts: { 1: 10, 2: 10, 3: 10 },
		season: null,
		productionStatus: 'Returning Series',
		voteAverage: 8,
		voteCount: 1200,
		backdropPath: null,
		posterPath: null,
		cast: [],
		trailerKey: null,
		watch: null,
		...over
	};
}

/** Minimal event: the actions read only the form body and the session user. */
function event(
	form: Record<string, string>,
	userId: string | null = '00000000-0000-4000-8000-000000000001'
): RequestEvent {
	return {
		request: new Request('http://localhost/watchlist', {
			method: 'POST',
			body: new URLSearchParams(form)
		}),
		locals: { user: userId ? { id: userId, name: 'T', email: 't@e.com', avatarUrl: null } : null }
	} as unknown as RequestEvent;
}

const call = (
	name: keyof typeof watchlistActions,
	form: Record<string, string>,
	userId?: string | null
) => (watchlistActions[name] as (e: RequestEvent) => Promise<unknown>)(event(form, userId));

/** Insert a saved show and hand back its id. */
async function saveShow(over: Partial<ItemSeed> = {}) {
	const [row] = await seedItems(harness.admin, {
		id: '00000000-0000-4000-8000-000000000007',
		userId: '00000000-0000-4000-8000-000000000001',
		tmdbId: 1,
		mediaType: 'tv',
		title: 'Silo',
		totalSeasons: 3,
		airedSeasons: 3,
		...over
	});
	return row;
}

const read = async (id = '00000000-0000-4000-8000-000000000007') =>
	(await selectWatchlist(harness.admin).where(eq(watchlistItem.id, id)))[0];

beforeEach(async () => {
	harness = await createTestDatabase();
	await seedUser(harness.admin);
	details.mockReset();
	details.mockResolvedValue(showDetails());
});

describe('setSeasons', () => {
	/**
	 * The regression that shipped: the season picker moved the counter and left
	 * the episode bookmark behind, so jumping to season 2 from S2E4 recorded four
	 * episodes of season *three* that nobody had watched.
	 */
	it('clears the episode bookmark when the season moves', async () => {
		await saveShow({ seasonsSeen: 1, episodesIntoSeason: 4 });

		await call('setSeasons', { id: '00000000-0000-4000-8000-000000000007', seasons: '2' });

		expect(await read()).toMatchObject({ seasonsSeen: 2, episodesIntoSeason: 0 });
	});

	it('marks a show watched only on the last aired season', async () => {
		await saveShow({ seasonsSeen: 1, episodesIntoSeason: 4 });

		await call('setSeasons', { id: '00000000-0000-4000-8000-000000000007', seasons: '3' });

		expect(await read()).toMatchObject({ seasonsSeen: 3, episodesIntoSeason: 0, watched: true });
	});

	// The ceiling is aired seasons, never TMDB's announced total.
	it('refuses to tick off a season that has not aired', async () => {
		details.mockResolvedValue(
			showDetails({
				seasons: 4,
				airedSeasons: 3,
				upcomingSeason: { number: 4, airDate: '2027-01-01' }
			})
		);
		await saveShow({ seasonsSeen: 0, airedSeasons: null });

		await call('setSeasons', { id: '00000000-0000-4000-8000-000000000007', seasons: '4' });

		expect(await read()).toMatchObject({ seasonsSeen: 3, watched: true });
	});
});

describe('toggleWatched', () => {
	it('clears the episode bookmark in both directions', async () => {
		await saveShow({ seasonsSeen: 2, episodesIntoSeason: 5 });

		await call('toggleWatched', { id: '00000000-0000-4000-8000-000000000007' });
		expect(await read()).toMatchObject({ watched: true, seasonsSeen: 3, episodesIntoSeason: 0 });

		await call('toggleWatched', { id: '00000000-0000-4000-8000-000000000007' });
		expect(await read()).toMatchObject({ watched: false, episodesIntoSeason: 0 });
	});

	it('stamps when it became watched, and clears it on the way back', async () => {
		await saveShow();

		await call('toggleWatched', { id: '00000000-0000-4000-8000-000000000007' });
		expect((await read()).watchedAt).toBeInstanceOf(Date);

		await call('toggleWatched', { id: '00000000-0000-4000-8000-000000000007' });
		expect((await read()).watchedAt).toBeNull();
	});

	/**
	 * You cannot have watched what has not come out. The card renders the release
	 * date instead of the button, so this is the guard for a form body that card
	 * did not build.
	 */
	it('refuses to mark a title watched before it is released', async () => {
		await saveShow({ releaseDate: '2999-01-01' });

		expect(
			await call('toggleWatched', { id: '00000000-0000-4000-8000-000000000007' })
		).toMatchObject({ status: 400 });
		expect(await read()).toMatchObject({ watched: false });
	});

	// Not knowing when something came out is not knowing that it has not; see
	// `canMarkWatched`.
	it('still allows a title TMDB has no date for', async () => {
		await saveShow({ releaseDate: null });

		await call('toggleWatched', { id: '00000000-0000-4000-8000-000000000007' });
		expect(await read()).toMatchObject({ watched: true });
	});

	/**
	 * Only the way in is guarded. A row saved before the rule, or one whose date
	 * TMDB has since moved outwards, must never be stuck claiming something its
	 * owner cannot take back.
	 */
	it('always allows un-watching, even once the date has moved into the future', async () => {
		await saveShow({ releaseDate: '2999-01-01', watched: true, seasonsSeen: 3 });

		await call('toggleWatched', { id: '00000000-0000-4000-8000-000000000007' });
		expect(await read()).toMatchObject({ watched: false });
	});
});

describe('setEpisode', () => {
	it('records a position inside the season in progress', async () => {
		details.mockResolvedValue(
			showDetails({ season: { seasonNumber: 2, episodes: [], airedCount: 10 } })
		);
		await saveShow({ seasonsSeen: 1 });

		await call('setEpisode', {
			id: '00000000-0000-4000-8000-000000000007',
			season: '2',
			episode: '4'
		});

		expect(await read()).toMatchObject({ seasonsSeen: 1, episodesIntoSeason: 4, watched: false });
	});

	/** One position, one encoding: a finished season is a finished season. */
	it('rolls a completed season into the season counter', async () => {
		details.mockResolvedValue(
			showDetails({ season: { seasonNumber: 2, episodes: [], airedCount: 10 } })
		);
		await saveShow({ seasonsSeen: 1, episodesIntoSeason: 4 });

		await call('setEpisode', {
			id: '00000000-0000-4000-8000-000000000007',
			season: '2',
			episode: '10'
		});

		expect(await read()).toMatchObject({ seasonsSeen: 2, episodesIntoSeason: 0 });
	});

	it('never records an episode that has not been broadcast', async () => {
		// Season 3 has ten episodes but only three have aired.
		details.mockResolvedValue(
			showDetails({ season: { seasonNumber: 3, episodes: [], airedCount: 3 } })
		);
		await saveShow({ seasonsSeen: 2 });

		await call('setEpisode', {
			id: '00000000-0000-4000-8000-000000000007',
			season: '3',
			episode: '9'
		});

		expect(await read()).toMatchObject({ seasonsSeen: 2, episodesIntoSeason: 3, watched: false });
	});

	it('rejects a season beyond what has aired', async () => {
		await saveShow({ seasonsSeen: 0 });

		const result = await call('setEpisode', {
			id: '00000000-0000-4000-8000-000000000007',
			season: '9',
			episode: '1'
		});

		expect(result).toMatchObject({ status: 400 });
		expect(await read()).toMatchObject({ seasonsSeen: 0, episodesIntoSeason: 0 });
	});

	it('refuses to track episodes on a film', async () => {
		await saveShow({ mediaType: 'movie', totalSeasons: null, airedSeasons: null });

		const result = await call('setEpisode', {
			id: '00000000-0000-4000-8000-000000000007',
			season: '1',
			episode: '1'
		});

		expect(result).toMatchObject({ status: 400 });
	});
});

/**
 * Turning the feature on must not delete anything on the spot.
 *
 * The countdown is only half of it; the other half is the week of warning the
 * card shows before the end. A title watched two months before you picked a
 * window would run out the instant you picked it — destroyed having never once
 * said it was going to be. So the window means "from here".
 */
describe('setAutoDelete', () => {
	const DAY = 86_400_000;
	const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
	/** Whole days since the row was stamped watched. */
	const ageInDays = async (id = '00000000-0000-4000-8000-000000000007') =>
		Math.round((Date.now() - (await read(id)).watchedAt!.getTime()) / DAY);

	it('stores an offered window', async () => {
		expect(await call('setAutoDelete', { days: '30' })).toEqual({ autoDeleteDays: 30 });
	});

	it('refuses a window it does not offer, rather than storing it as off', async () => {
		await call('setAutoDelete', { days: '30' });

		expect(await call('setAutoDelete', { days: '3' })).toMatchObject({ status: 400 });

		const [row] = await harness.admin
			.select()
			.from(user)
			.where(eq(user.id, '00000000-0000-4000-8000-000000000001'));
		expect(row?.autoDeleteDays).toBe(30);
	});

	it('restarts the clock on a title already past the new window', async () => {
		await saveShow({ watched: true, watchedAt: daysAgo(60) });

		await call('setAutoDelete', { days: '30' });

		expect(await ageInDays()).toBe(0);
	});

	it('leaves a title that is still inside the window on its original clock', async () => {
		await saveShow({ watched: true, watchedAt: daysAgo(10) });

		await call('setAutoDelete', { days: '30' });

		expect(await ageInDays()).toBe(10);
	});

	// Shortening is the same hazard as switching it on: rows that were comfortably
	// inside the old window can be past the new one before the page repaints.
	it('restarts the clock when the window is shortened past a title', async () => {
		await saveShow({ watched: true, watchedAt: daysAgo(20) });
		await call('setAutoDelete', { days: '30' });

		await call('setAutoDelete', { days: '7' });

		expect(await ageInDays()).toBe(0);
	});

	it('never touches an unwatched title, which has no clock to restart', async () => {
		await saveShow({ watched: false, watchedAt: null });

		await call('setAutoDelete', { days: '7' });

		expect((await read()).watchedAt).toBeNull();
	});

	it('changes nothing when the feature is turned off', async () => {
		await saveShow({ watched: true, watchedAt: daysAgo(60) });

		await call('setAutoDelete', { days: '' });

		expect(await ageInDays()).toBe(60);
	});

	it('leaves another account s overdue titles alone', async () => {
		await seedUser(harness.admin, {
			id: '00000000-0000-4000-8000-000000000002',
			googleId: 'g-2',
			email: 'two@example.test'
		});
		await saveShow({
			id: '00000000-0000-4000-8000-000000000008',
			userId: '00000000-0000-4000-8000-000000000002',
			tmdbId: 2,
			watched: true,
			watchedAt: daysAgo(60)
		});

		await call('setAutoDelete', { days: '30' });

		expect(await ageInDays('00000000-0000-4000-8000-000000000008')).toBe(60);
	});
});

describe('ownership', () => {
	/**
	 * Item ids travel through the browser as form fields, so knowing one must not
	 * be enough to touch it. Every mutation is scoped by the session's user id.
	 */
	it('will not let one account mutate another account s row', async () => {
		await seedUser(harness.admin, {
			id: '00000000-0000-4000-8000-000000000002',
			googleId: 'google-2',
			email: 'b@e.com'
		});
		await saveShow({ seasonsSeen: 1, episodesIntoSeason: 4 });

		await call(
			'setSeasons',
			{ id: '00000000-0000-4000-8000-000000000007', seasons: '3' },
			'00000000-0000-4000-8000-000000000002'
		);
		await call(
			'remove',
			{ id: '00000000-0000-4000-8000-000000000007' },
			'00000000-0000-4000-8000-000000000002'
		);
		await call(
			'toggleWatched',
			{ id: '00000000-0000-4000-8000-000000000007' },
			'00000000-0000-4000-8000-000000000002'
		);

		expect(await read()).toMatchObject({ seasonsSeen: 1, episodesIntoSeason: 4, watched: false });
	});

	it('turns every action away without a session', async () => {
		await saveShow();

		for (const action of ['remove', 'toggleWatched', 'setSeasons', 'setEpisode'] as const) {
			expect(
				await call(
					action,
					{ id: '00000000-0000-4000-8000-000000000007', seasons: '2', season: '1', episode: '1' },
					null
				)
			).toMatchObject({ status: 401 });
		}
		expect(await read()).toBeDefined();
	});
});

describe('validation', () => {
	/**
	 * A value outside the schema is refused, never repaired: truncating, clamping
	 * or defaulting would store something nobody sent.
	 */
	it('refuses a field the form does not have', async () => {
		await saveShow();

		expect(
			await call('remove', { id: '00000000-0000-4000-8000-000000000007', extra: 'x' })
		).toMatchObject({ status: 400 });
		expect(await read()).toBeDefined();
	});

	it('refuses an overlong value instead of cutting it', async () => {
		const form = { tmdbId: '1', mediaType: 'tv', title: 'x'.repeat(301) };

		expect(await call('add', form)).toMatchObject({ status: 400 });
		expect(await selectWatchlist(harness.admin)).toHaveLength(0);
	});

	it('refuses a number written any way but plainly', async () => {
		await saveShow();

		for (const seasons of ['1.5', '-1', '1e1', ' 2', '0x2', '']) {
			expect(
				await call('setSeasons', { id: '00000000-0000-4000-8000-000000000007', seasons })
			).toMatchObject({ status: 400 });
		}
	});

	it('refuses a rating outside 0 to 10', async () => {
		const form = { tmdbId: '1', mediaType: 'tv', title: 'Silo', voteAverage: '11' };

		expect(await call('add', form)).toMatchObject({ status: 400 });
	});

	it('refuses a body past the size limit', async () => {
		const form = { tmdbId: '1', mediaType: 'tv', title: 'Silo', overview: 'x'.repeat(40_000) };

		expect(await call('add', form)).toMatchObject({ status: 400 });
	});
});

describe('rate limit', () => {
	it('turns an account over its limit away before the action runs', async () => {
		await saveShow();
		isRateLimited.mockResolvedValueOnce(true);

		expect(await call('remove', { id: '00000000-0000-4000-8000-000000000007' })).toMatchObject({
			status: 429
		});
		expect(isRateLimited).toHaveBeenCalledWith(
			'ACCOUNT_RATE_LIMIT',
			'00000000-0000-4000-8000-000000000001'
		);
		expect(await read()).toBeDefined();
	});
});

describe('add', () => {
	it('rejects forged metadata and stores only TMDB responses for both owners', async () => {
		const forged = {
			tmdbId: '1',
			mediaType: 'tv',
			title: 'Forged title',
			posterPath: '/forged.jpg'
		};
		expect(await call('add', forged)).toMatchObject({ status: 400 });
		expect(await harness.admin.select().from(schema.media)).toHaveLength(0);
		await call('add', { tmdbId: '1', mediaType: 'tv' });
		await seedUser(harness.admin, { id: '00000000-0000-4000-8000-000000000002', googleId: 'bob' });
		await call('add', { tmdbId: '1', mediaType: 'tv' }, '00000000-0000-4000-8000-000000000002');
		expect(await call('add', forged, '00000000-0000-4000-8000-000000000002')).toMatchObject({
			status: 400
		});
		const rows = await selectWatchlist(harness.admin);
		expect(rows).toHaveLength(2);
		for (const row of rows) expect(row).toMatchObject({ title: 'Silo', posterPath: null });
		expect(new Set(rows.map((row) => row.mediaId)).size).toBe(1);
	});

	it('rejects a forged userId without changing either account', async () => {
		await seedUser(harness.admin, { id: '00000000-0000-4000-8000-000000000002', googleId: 'bob' });
		expect(
			await call('add', {
				tmdbId: '1',
				mediaType: 'tv',
				userId: '00000000-0000-4000-8000-000000000002'
			})
		).toMatchObject({ status: 400 });
		expect(await selectWatchlist(harness.admin)).toEqual([]);
		expect(await harness.admin.select().from(schema.media)).toEqual([]);
	});

	it('refuses a new title when TMDB metadata is unavailable', async () => {
		details.mockRejectedValue(new Error('network'));
		expect(await call('add', { tmdbId: '8', mediaType: 'movie' })).toMatchObject({ status: 502 });
		expect(await selectWatchlist(harness.admin)).toEqual([]);
		expect(await harness.admin.select().from(schema.media)).toEqual([]);
	});

	it('reuses existing metadata during a TMDB outage', async () => {
		await seedItems(harness.admin, {
			userId: testUser().id,
			tmdbId: 8,
			mediaType: 'movie',
			title: 'Trusted'
		});
		await seedUser(harness.admin, { id: '00000000-0000-4000-8000-000000000002', googleId: 'bob' });
		details.mockRejectedValue(new Error('network'));
		expect(
			await call('add', { tmdbId: '8', mediaType: 'movie' }, '00000000-0000-4000-8000-000000000002')
		).toMatchObject({ added: true });
		expect((await selectWatchlist(harness.admin)).map((row) => row.title)).toEqual([
			'Trusted',
			'Trusted'
		]);
	});

	it('serializes concurrent adds from different connections at one below the cap', async () => {
		await harness.admin.execute(
			sql`insert into nextsode.media (tmdb_id, media_type, title) select n, 'movie', 'Seed' from pg_catalog.generate_series(1, 4999) n`
		);
		await harness.admin.execute(
			sql`insert into nextsode.watchlist_item (user_id, media_id) select ${testUser().id}::uuid, id from nextsode.media`
		);
		const url = new URL(testDatabaseUrl());
		url.pathname = new URL(harness.db.$client.options.connectionString!).pathname;
		url.username = 'nextsode_app';
		url.password = inject('testAppPassword');
		const client = new Pool({ connectionString: url.toString(), max: 1 });
		try {
			const otherDb = drizzle(client, { schema });
			connections.next.push(harness.db, otherDb, harness.db, otherDb);
			const results = await Promise.all([
				call('add', { tmdbId: '6000', mediaType: 'movie' }),
				call('add', { tmdbId: '6001', mediaType: 'movie' })
			]);
			expect(results).toContainEqual({ added: true });
			expect(results).toContainEqual(expect.objectContaining({ status: 400 }));
			const [row] = await harness.admin
				.select({ count: sql<number>`count(*)::integer` })
				.from(watchlistItem);
			expect(row.count).toBe(5000);
		} finally {
			connections.next.length = 0;
			await client.end();
		}
	}, 15_000);

	it('saves a title once, however many times it is submitted', async () => {
		const form = { tmdbId: '1', mediaType: 'tv' };

		expect(await call('add', form)).toMatchObject({ added: true });
		details.mockClear();
		expect(await call('add', form)).toMatchObject({ added: false });
		expect(details).not.toHaveBeenCalled();

		const rows = await selectWatchlist(harness.admin);
		expect(rows).toHaveLength(1);
	});

	it('rejects a submission with no usable title', async () => {
		expect(await call('add', { tmdbId: '1', mediaType: 'tv', title: '  ' })).toMatchObject({
			status: 400
		});
	});

	it('uses one TMDB response for TV metadata and season data', async () => {
		details.mockResolvedValueOnce(showDetails()).mockRejectedValue(new Error('network'));

		expect(await call('add', { tmdbId: '7', mediaType: 'tv' })).toMatchObject({
			added: true
		});
		const [row] = await selectWatchlist(harness.admin);
		expect(row).toMatchObject({ title: 'Silo', totalSeasons: 3, airedSeasons: 3 });
		expect(details).toHaveBeenCalledExactlyOnceWith('tv', 7);
	});

	it('saves a TV title when TMDB has no usable season data', async () => {
		details.mockResolvedValue(showDetails({ seasons: null, airedSeasons: null }));

		expect(await call('add', { tmdbId: '7', mediaType: 'tv' })).toMatchObject({ added: true });
		const [row] = await selectWatchlist(harness.admin);
		expect(row).toMatchObject({ totalSeasons: 0, airedSeasons: 0 });
		expect(details).toHaveBeenCalledExactlyOnceWith('tv', 7);
	});
});

describe('share link', () => {
	/** The stored token and scope, which is what these actions exist to write. */
	const settings = async (userId = '00000000-0000-4000-8000-000000000001') =>
		(
			await harness.admin
				.select({ token: user.shareToken, scope: user.shareScope })
				.from(user)
				.where(eq(user.id, userId))
		)[0];

	// An unchecked box is absent from a form body rather than false, so presence
	// is the whole test.
	it('reads the scope from whichever boxes were ticked', async () => {
		await call('issueShareLink', { toWatch: 'on' });
		expect((await settings())?.scope).toBe('toWatch');

		await call('updateShareScope', { watched: 'on' });
		expect((await settings())?.scope).toBe('watched');

		await call('updateShareScope', { toWatch: 'on', watched: 'on' });
		expect((await settings())?.scope).toBe('both');
	});

	/**
	 * There is no way to spell "share my list, showing nothing", and quietly
	 * picking a default here would publish something nobody ticked.
	 */
	it('refuses to publish anything when no box is ticked', async () => {
		expect(await call('issueShareLink', {})).toMatchObject({ status: 400 });
		expect((await settings())?.token).toBeNull();
	});

	it('refuses to widen an existing link to nothing', async () => {
		await call('issueShareLink', { watched: 'on' });
		expect(await call('updateShareScope', {})).toMatchObject({ status: 400 });
		expect((await settings())?.scope).toBe('watched');
	});

	// Re-scoping must not break the URL already sent; rolling over must.
	it('keeps the link when re-scoping and replaces it when rolling over', async () => {
		await call('issueShareLink', { toWatch: 'on' });
		const first = (await settings())?.token;

		await call('updateShareScope', { watched: 'on' });
		expect((await settings())?.token).toBe(first);

		await call('issueShareLink', { watched: 'on' });
		expect((await settings())?.token).not.toBe(first);
	});

	it('turns the link off entirely', async () => {
		await call('issueShareLink', { toWatch: 'on' });
		await call('revokeShareLink', {});

		expect(await settings()).toEqual({ token: null, scope: null });
	});

	it('turns every share action away without a session', async () => {
		for (const action of ['issueShareLink', 'updateShareScope', 'revokeShareLink'] as const) {
			expect(await call(action, { toWatch: 'on' }, null)).toMatchObject({ status: 401 });
		}
		expect((await settings())?.token).toBeNull();
	});

	it('publishes only the caller s own list', async () => {
		await seedUser(harness.admin, {
			id: '00000000-0000-4000-8000-000000000002',
			googleId: 'google-2',
			email: 'b@e.com'
		});

		await call('issueShareLink', { toWatch: 'on' }, '00000000-0000-4000-8000-000000000002');

		expect((await settings('00000000-0000-4000-8000-000000000001'))?.token).toBeNull();
		expect((await settings('00000000-0000-4000-8000-000000000002'))?.token).toMatch(
			/^[0-9a-f]{64}$/
		);
	});
});

afterEach(async () => {
	await harness?.close();
});

describe('row identifiers', () => {
	it('refuses malformed UUIDs before they reach Postgres', async () => {
		expect(await call('remove', { id: 'not-a-uuid' })).toMatchObject({ status: 400 });
	});
	it('keeps the existing Keep action on an unwatched item', async () => {
		const item = await saveShow({ watched: false });
		expect(await call('keepLonger', { id: item.id })).toMatchObject({ kept: true });
		expect((await read()).watchedAt).toBeInstanceOf(Date);
		expect((await read()).watched).toBe(false);
	});
});

describe('transaction boundaries', () => {
	it.each(['add', 'setEpisode', 'setSeasons'] as const)(
		'%s releases the app transaction before calling TMDB',
		async (action) => {
			if (action !== 'add') await saveShow();
			const activeTransactions: number[] = [];
			details.mockImplementation(async () => {
				const result = await harness.admin.execute(
					sql`select pid from pg_catalog.pg_stat_activity where datname = current_database() and usename = 'nextsode_app' and state = 'idle in transaction'`
				);
				activeTransactions.push(result.rows.length);
				return showDetails({ season: { seasonNumber: 2, episodes: [], airedCount: 10 } });
			});
			const result =
				action === 'add'
					? await call(action, { tmdbId: '9', mediaType: 'tv' })
					: action === 'setEpisode'
						? await call(action, {
								id: '00000000-0000-4000-8000-000000000007',
								season: '2',
								episode: '4'
							})
						: await call(action, { id: '00000000-0000-4000-8000-000000000007', seasons: '3' });
			expect(result).not.toHaveProperty('status');
			expect(activeTransactions.length).toBeGreaterThan(0);
			expect(activeTransactions.every((count) => count === 0)).toBe(true);
		}
	);
});
