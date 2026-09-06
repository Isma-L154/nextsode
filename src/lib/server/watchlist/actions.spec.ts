import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { createTestDatabase, seedUser, type TestDatabase } from '../test-db';
import { user, watchlistItem } from '../db/schema';
import type { MediaDetails } from '$lib/types';

/**
 * The form actions, against a real database.
 *
 * This is where every bug found by hand has actually lived. The domain layer is
 * pure and exhaustively covered; the actions are where that logic meets a row,
 * and "the write forgot a column" is a defect no amount of domain testing can
 * see.
 */

let harness: TestDatabase;

vi.mock('../db', () => ({ getDb: () => harness.db }));

/** TMDB's answer, stubbed. The network is not what is under test here. */
const details = vi.hoisted(() => vi.fn());
vi.mock('../tmdb', () => ({ getDetails: details }));

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
function event(form: Record<string, string>, userId: string | null = 'user-1'): RequestEvent {
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
async function saveShow(over: Partial<typeof watchlistItem.$inferInsert> = {}) {
	const [row] = await harness.db
		.insert(watchlistItem)
		.values({
			id: 'item-1',
			userId: 'user-1',
			tmdbId: 1,
			mediaType: 'tv',
			title: 'Silo',
			totalSeasons: 3,
			airedSeasons: 3,
			...over
		})
		.returning();
	return row;
}

const read = async (id = 'item-1') =>
	(await harness.db.select().from(watchlistItem).where(eq(watchlistItem.id, id)))[0];

beforeEach(async () => {
	harness = await createTestDatabase();
	await seedUser(harness.db);
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

		await call('setSeasons', { id: 'item-1', seasons: '2' });

		expect(await read()).toMatchObject({ seasonsSeen: 2, episodesIntoSeason: 0 });
	});

	it('marks a show watched only on the last aired season', async () => {
		await saveShow({ seasonsSeen: 1, episodesIntoSeason: 4 });

		await call('setSeasons', { id: 'item-1', seasons: '3' });

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

		await call('setSeasons', { id: 'item-1', seasons: '4' });

		expect(await read()).toMatchObject({ seasonsSeen: 3, watched: true });
	});
});

describe('toggleWatched', () => {
	it('clears the episode bookmark in both directions', async () => {
		await saveShow({ seasonsSeen: 2, episodesIntoSeason: 5 });

		await call('toggleWatched', { id: 'item-1' });
		expect(await read()).toMatchObject({ watched: true, seasonsSeen: 3, episodesIntoSeason: 0 });

		await call('toggleWatched', { id: 'item-1' });
		expect(await read()).toMatchObject({ watched: false, episodesIntoSeason: 0 });
	});

	it('stamps when it became watched, and clears it on the way back', async () => {
		await saveShow();

		await call('toggleWatched', { id: 'item-1' });
		expect((await read()).watchedAt).toBeInstanceOf(Date);

		await call('toggleWatched', { id: 'item-1' });
		expect((await read()).watchedAt).toBeNull();
	});

	/**
	 * You cannot have watched what has not come out. The card renders the release
	 * date instead of the button, so this is the guard for a form body that card
	 * did not build.
	 */
	it('refuses to mark a title watched before it is released', async () => {
		await saveShow({ releaseDate: '2999-01-01' });

		expect(await call('toggleWatched', { id: 'item-1' })).toMatchObject({ status: 400 });
		expect(await read()).toMatchObject({ watched: false });
	});

	// Not knowing when something came out is not knowing that it has not; see
	// `canMarkWatched`.
	it('still allows a title TMDB has no date for', async () => {
		await saveShow({ releaseDate: null });

		await call('toggleWatched', { id: 'item-1' });
		expect(await read()).toMatchObject({ watched: true });
	});

	/**
	 * Only the way in is guarded. A row saved before the rule, or one whose date
	 * TMDB has since moved outwards, must never be stuck claiming something its
	 * owner cannot take back.
	 */
	it('always allows un-watching, even once the date has moved into the future', async () => {
		await saveShow({ releaseDate: '2999-01-01', watched: true, seasonsSeen: 3 });

		await call('toggleWatched', { id: 'item-1' });
		expect(await read()).toMatchObject({ watched: false });
	});
});

describe('setEpisode', () => {
	it('records a position inside the season in progress', async () => {
		details.mockResolvedValue(
			showDetails({ season: { seasonNumber: 2, episodes: [], airedCount: 10 } })
		);
		await saveShow({ seasonsSeen: 1 });

		await call('setEpisode', { id: 'item-1', season: '2', episode: '4' });

		expect(await read()).toMatchObject({ seasonsSeen: 1, episodesIntoSeason: 4, watched: false });
	});

	/** One position, one encoding: a finished season is a finished season. */
	it('rolls a completed season into the season counter', async () => {
		details.mockResolvedValue(
			showDetails({ season: { seasonNumber: 2, episodes: [], airedCount: 10 } })
		);
		await saveShow({ seasonsSeen: 1, episodesIntoSeason: 4 });

		await call('setEpisode', { id: 'item-1', season: '2', episode: '10' });

		expect(await read()).toMatchObject({ seasonsSeen: 2, episodesIntoSeason: 0 });
	});

	it('never records an episode that has not been broadcast', async () => {
		// Season 3 has ten episodes but only three have aired.
		details.mockResolvedValue(
			showDetails({ season: { seasonNumber: 3, episodes: [], airedCount: 3 } })
		);
		await saveShow({ seasonsSeen: 2 });

		await call('setEpisode', { id: 'item-1', season: '3', episode: '9' });

		expect(await read()).toMatchObject({ seasonsSeen: 2, episodesIntoSeason: 3, watched: false });
	});

	it('rejects a season beyond what has aired', async () => {
		await saveShow({ seasonsSeen: 0 });

		const result = await call('setEpisode', { id: 'item-1', season: '9', episode: '1' });

		expect(result).toMatchObject({ status: 400 });
		expect(await read()).toMatchObject({ seasonsSeen: 0, episodesIntoSeason: 0 });
	});

	it('refuses to track episodes on a film', async () => {
		await saveShow({ mediaType: 'movie', totalSeasons: null, airedSeasons: null });

		const result = await call('setEpisode', { id: 'item-1', season: '1', episode: '1' });

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
	const ageInDays = async (id = 'item-1') =>
		Math.round((Date.now() - (await read(id)).watchedAt!.getTime()) / DAY);

	it('stores an offered window', async () => {
		expect(await call('setAutoDelete', { days: '30' })).toEqual({ autoDeleteDays: 30 });
	});

	it('stores anything unrecognised as off rather than rejecting it', async () => {
		expect(await call('setAutoDelete', { days: '3' })).toEqual({ autoDeleteDays: null });
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
		await seedUser(harness.db, { id: 'user-2', googleId: 'g-2', email: 'two@example.test' });
		await saveShow({
			id: 'item-2',
			userId: 'user-2',
			tmdbId: 2,
			watched: true,
			watchedAt: daysAgo(60)
		});

		await call('setAutoDelete', { days: '30' });

		expect(await ageInDays('item-2')).toBe(60);
	});
});

describe('ownership', () => {
	/**
	 * Item ids travel through the browser as form fields, so knowing one must not
	 * be enough to touch it. Every mutation is scoped by the session's user id.
	 */
	it('will not let one account mutate another account s row', async () => {
		await seedUser(harness.db, { id: 'user-2', googleId: 'google-2', email: 'b@e.com' });
		await saveShow({ seasonsSeen: 1, episodesIntoSeason: 4 });

		await call('setSeasons', { id: 'item-1', seasons: '3' }, 'user-2');
		await call('remove', { id: 'item-1' }, 'user-2');
		await call('toggleWatched', { id: 'item-1' }, 'user-2');

		expect(await read()).toMatchObject({ seasonsSeen: 1, episodesIntoSeason: 4, watched: false });
	});

	it('turns every action away without a session', async () => {
		await saveShow();

		for (const action of ['remove', 'toggleWatched', 'setSeasons', 'setEpisode'] as const) {
			expect(
				await call(action, { id: 'item-1', seasons: '2', season: '1', episode: '1' }, null)
			).toMatchObject({ status: 401 });
		}
		expect(await read()).toBeDefined();
	});
});

describe('add', () => {
	it('saves a title once, however many times it is submitted', async () => {
		const form = { tmdbId: '1', mediaType: 'tv', title: 'Silo' };

		expect(await call('add', form)).toMatchObject({ added: true });
		expect(await call('add', form)).toMatchObject({ added: false });

		const rows = await harness.db.select().from(watchlistItem);
		expect(rows).toHaveLength(1);
	});

	it('rejects a submission with no usable title', async () => {
		expect(await call('add', { tmdbId: '1', mediaType: 'tv', title: '  ' })).toMatchObject({
			status: 400
		});
	});

	/** A failed lookup must not stop the save; the read path repairs it later. */
	it('still saves when TMDB cannot be reached', async () => {
		details.mockRejectedValue(new Error('network'));

		expect(await call('add', { tmdbId: '7', mediaType: 'tv', title: 'Andor' })).toMatchObject({
			added: true
		});
		const [row] = await harness.db.select().from(watchlistItem);
		expect(row.airedSeasons).toBeNull();
	});
});

describe('share link', () => {
	/** The stored token and scope, which is what these actions exist to write. */
	const settings = async (userId = 'user-1') =>
		(
			await harness.db
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
		await seedUser(harness.db, { id: 'user-2', googleId: 'google-2', email: 'b@e.com' });

		await call('issueShareLink', { toWatch: 'on' }, 'user-2');

		expect((await settings('user-1'))?.token).toBeNull();
		expect((await settings('user-2'))?.token).toMatch(/^[0-9a-f]{64}$/);
	});
});
