import { describe, expect, it } from 'vitest';
import { applyWatchlistView, countByStatus, type WatchlistEntry } from './watchlist';

// Fixed "today" so the release-date assertions never drift with the calendar.
const now = new Date('2026-07-29T12:00:00Z');

/** Builds an entry with sensible defaults so each test states only what matters. */
const entry = (over: Partial<WatchlistEntry> & { title: string }): WatchlistEntry => ({
	mediaType: 'movie',
	watched: false,
	voteAverage: null,
	releaseDate: null,
	seasonsSeen: 0,
	episodesIntoSeason: 0,
	totalSeasons: null,
	airedSeasons: null,
	nextSeasonNumber: null,
	nextSeasonAirDate: null,
	...over
});

const items: WatchlistEntry[] = [
	entry({ title: 'The Matrix', voteAverage: 8.2, releaseDate: '1999-03-31' }),
	entry({
		title: 'Breaking Bad',
		mediaType: 'tv',
		watched: true,
		voteAverage: 8.9,
		releaseDate: '2008-01-20',
		seasonsSeen: 5,
		totalSeasons: 5
	}),
	entry({ title: 'Arrival', watched: true, voteAverage: 7.6, releaseDate: '2016-11-11' }),
	entry({
		title: 'Andor',
		mediaType: 'tv',
		releaseDate: '2022-09-21',
		seasonsSeen: 1,
		totalSeasons: 2
	})
];

/** Two unreleased titles, deliberately in the "wrong" order for sort tests. */
const withUpcoming: WatchlistEntry[] = [
	...items,
	entry({ title: 'Dune: Part Three', releaseDate: '2027-03-18' }),
	entry({ title: 'Untitled Sequel', voteAverage: 6.1, releaseDate: '2026-12-25' })
];

const baseView = { status: 'all', type: 'all', sort: 'recent', query: '' };

describe('applyWatchlistView — filtering', () => {
	it('returns everything by default', () => {
		expect(applyWatchlistView(items, baseView, now)).toHaveLength(4);
	});

	it('filters by "to watch" status', () => {
		const result = applyWatchlistView(items, { ...baseView, status: 'toWatch' }, now);
		expect(result.map((i) => i.title)).toEqual(['The Matrix', 'Andor']);
	});

	it('filters by "watched" status', () => {
		const result = applyWatchlistView(items, { ...baseView, status: 'watched' }, now);
		expect(result.map((i) => i.title)).toEqual(['Breaking Bad', 'Arrival']);
	});

	it('filters by "in progress" status — started shows that are not finished', () => {
		const result = applyWatchlistView(items, { ...baseView, status: 'inProgress' }, now);
		expect(result.map((i) => i.title)).toEqual(['Andor']);
	});

	/**
	 * The regression episode tracking introduced: progress inside season one leaves
	 * `seasonsSeen` at zero, so counting seasons alone reported "not started" for a
	 * show the viewer is demonstrably in the middle of.
	 */
	it('counts a part-watched first season as in progress', () => {
		const partWay = [
			entry({
				title: 'Silo',
				mediaType: 'tv',
				seasonsSeen: 0,
				episodesIntoSeason: 4,
				totalSeasons: 3,
				airedSeasons: 3
			})
		];

		const result = applyWatchlistView(partWay, { ...baseView, status: 'inProgress' }, now);
		expect(result.map((i) => i.title)).toEqual(['Silo']);
		expect(countByStatus(partWay, now).inProgress).toBe(1);
	});

	it('filters by "upcoming" status', () => {
		const result = applyWatchlistView(withUpcoming, { ...baseView, status: 'upcoming' }, now);
		expect(result.map((i) => i.title)).toEqual(['Dune: Part Three', 'Untitled Sequel']);
	});

	it('filters by media type', () => {
		const result = applyWatchlistView(items, { ...baseView, type: 'tv' }, now);
		expect(result.map((i) => i.title)).toEqual(['Breaking Bad', 'Andor']);
	});

	it('filters by a case-insensitive title query', () => {
		const result = applyWatchlistView(items, { ...baseView, query: 'ARR' }, now);
		expect(result.map((i) => i.title)).toEqual(['Arrival']);
	});

	it('combines status, type and query', () => {
		const result = applyWatchlistView(
			items,
			{ ...baseView, status: 'toWatch', type: 'tv', query: 'and' },
			now
		);
		expect(result.map((i) => i.title)).toEqual(['Andor']);
	});
});

describe('applyWatchlistView — sorting', () => {
	it('preserves input order for "recent"', () => {
		const result = applyWatchlistView(items, baseView, now);
		expect(result.map((i) => i.title)).toEqual(['The Matrix', 'Breaking Bad', 'Arrival', 'Andor']);
	});

	it('sorts by rating (desc, nulls last)', () => {
		const result = applyWatchlistView(items, { ...baseView, sort: 'rating' }, now);
		expect(result.map((i) => i.title)).toEqual(['Breaking Bad', 'The Matrix', 'Arrival', 'Andor']);
	});

	it('sorts by title (A–Z)', () => {
		const result = applyWatchlistView(items, { ...baseView, sort: 'title' }, now);
		expect(result.map((i) => i.title)).toEqual(['Andor', 'Arrival', 'Breaking Bad', 'The Matrix']);
	});

	it('sorts by "soonest", pushing already-released titles to the end', () => {
		const result = applyWatchlistView(withUpcoming, { ...baseView, sort: 'soonest' }, now);
		expect(result.slice(0, 2).map((i) => i.title)).toEqual(['Untitled Sequel', 'Dune: Part Three']);
		expect(result).toHaveLength(6);
	});

	it('does not mutate the input array', () => {
		const snapshot = items.map((i) => i.title);
		applyWatchlistView(items, { ...baseView, sort: 'title' }, now);
		expect(items.map((i) => i.title)).toEqual(snapshot);
	});
});

describe('countByStatus', () => {
	it('counts every bucket', () => {
		expect(countByStatus(items, now)).toEqual({
			all: 4,
			toWatch: 2,
			inProgress: 1,
			upcoming: 0,
			watched: 2
		});
	});

	it('counts unreleased titles independently of the watched flag', () => {
		expect(countByStatus(withUpcoming, now)).toEqual({
			all: 6,
			toWatch: 4,
			inProgress: 1,
			upcoming: 2,
			watched: 2
		});
	});

	it('handles an empty list', () => {
		expect(countByStatus([], now)).toEqual({
			all: 0,
			toWatch: 0,
			inProgress: 0,
			upcoming: 0,
			watched: 0
		});
	});
});
