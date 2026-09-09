import { describe, expect, it } from 'vitest';
import {
	countByUpcomingWindow,
	getUpcomingInfo,
	hasUpcoming,
	isInUpcomingWindow,
	upcomingSortKey,
	upcomingWindowFor,
	type UpcomingEntry
} from './upcoming';

/** Fixed "today" so none of these drift with the calendar. */
const now = new Date('2026-08-12T12:00:00Z');

/** A date `days` from the fixed "today", as TMDB writes them. */
const isoIn = (days: number) =>
	new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);

const entry = (over: Partial<UpcomingEntry> = {}): UpcomingEntry => ({
	mediaType: 'tv',
	releaseDate: '2010-01-01',
	nextSeasonNumber: null,
	nextSeasonAirDate: null,
	...over
});

describe('getUpcomingInfo', () => {
	it('reports nothing for a released title with no pending season', () => {
		expect(getUpcomingInfo(entry(), now)).toBeNull();
	});

	it('reports an unreleased film by its release date', () => {
		const info = getUpcomingInfo(entry({ mediaType: 'movie', releaseDate: '2026-12-25' }), now);
		expect(info?.kind).toBe('release');
		expect(info?.daysUntil).toBe(135);
		expect(info?.seasonNumber).toBeNull();
	});

	/**
	 * The gap this module exists to close. A returning series first aired years
	 * ago, so judging by release date alone reported "nothing pending" for a show
	 * with a season two months out.
	 */
	it('reports a returning series by its next season', () => {
		const info = getUpcomingInfo(
			entry({ releaseDate: '2005-03-27', nextSeasonNumber: 23, nextSeasonAirDate: '2026-10-15' }),
			now
		);
		expect(info?.kind).toBe('season');
		expect(info?.seasonNumber).toBe(23);
		expect(info?.daysUntil).toBe(64);
	});

	// A show that has not premiered at all is waiting on its premiere, not on
	// "season 1" — otherwise the same event would be announced twice.
	it('prefers the title release over a pending season', () => {
		const info = getUpcomingInfo(
			entry({ releaseDate: '2026-09-01', nextSeasonNumber: 1, nextSeasonAirDate: '2026-09-01' }),
			now
		);
		expect(info?.kind).toBe('release');
	});

	it('reports an announced season with no date', () => {
		const info = getUpcomingInfo(entry({ nextSeasonNumber: 4, nextSeasonAirDate: null }), now);
		expect(info?.kind).toBe('season');
		expect(info?.date).toBeNull();
		expect(info?.daysUntil).toBeNull();
	});

	it('ignores a season whose air date has passed', () => {
		expect(
			getUpcomingInfo(entry({ nextSeasonNumber: 4, nextSeasonAirDate: '2026-08-01' }), now)
		).toBeNull();
	});

	it('never reports a pending season for a movie', () => {
		expect(
			getUpcomingInfo(
				entry({ mediaType: 'movie', nextSeasonNumber: 2, nextSeasonAirDate: '2027-01-01' }),
				now
			)
		).toBeNull();
	});
});

describe('hasUpcoming', () => {
	it('counts both kinds of pending title', () => {
		expect(hasUpcoming(entry({ mediaType: 'movie', releaseDate: '2027-01-01' }), now)).toBe(true);
		expect(hasUpcoming(entry({ nextSeasonNumber: 9, nextSeasonAirDate: '2026-10-01' }), now)).toBe(
			true
		);
		expect(hasUpcoming(entry(), now)).toBe(false);
	});

	// Announced-but-undated titles are not watchable, so they belong here rather
	// than lumped in with everything already out.
	it('includes announced titles with no date', () => {
		expect(hasUpcoming(entry({ nextSeasonNumber: 4, nextSeasonAirDate: null }), now)).toBe(true);
	});
});

describe('upcomingSortKey', () => {
	it('orders soonest first and sinks undated entries', () => {
		const soon = entry({ nextSeasonNumber: 2, nextSeasonAirDate: '2026-08-20' });
		const later = entry({ nextSeasonNumber: 2, nextSeasonAirDate: '2027-01-01' });
		const undated = entry({ nextSeasonNumber: 2, nextSeasonAirDate: null });

		expect(upcomingSortKey(soon, now)).toBeLessThan(upcomingSortKey(later, now));
		expect(upcomingSortKey(later, now)).toBeLessThan(upcomingSortKey(undated, now));
	});
});

describe('upcomingWindowFor', () => {
	const inDays = (n: number) => ({ nextSeasonNumber: 2, nextSeasonAirDate: isoIn(n) });

	it('places a title in the window its date falls in', () => {
		expect(upcomingWindowFor(entry(inDays(1)), now)).toBe('thisWeek');
		expect(upcomingWindowFor(entry(inDays(7)), now)).toBe('thisWeek');
		expect(upcomingWindowFor(entry(inDays(8)), now)).toBe('thisMonth');
		expect(upcomingWindowFor(entry(inDays(31)), now)).toBe('thisMonth');
		expect(upcomingWindowFor(entry(inDays(32)), now)).toBe('later');
	});

	it('gives an announced title with no date its own window', () => {
		expect(upcomingWindowFor(entry({ nextSeasonNumber: 2, nextSeasonAirDate: null }), now)).toBe(
			'undated'
		);
	});

	// Nothing pending is not a window; it is an absence, and the caller filters
	// on it before ever asking which bucket something is in.
	it('answers null for a title with nothing pending', () => {
		expect(upcomingWindowFor(entry(), now)).toBeNull();
	});
});

describe('isInUpcomingWindow', () => {
	const soon = entry({ nextSeasonNumber: 2, nextSeasonAirDate: isoIn(3) });

	// 'all' is what the filter lands on, so it must not quietly drop anything.
	it('lets everything pending through on "all"', () => {
		expect(isInUpcomingWindow(soon, 'all', now)).toBe(true);
		expect(
			isInUpcomingWindow(entry({ nextSeasonNumber: 2, nextSeasonAirDate: null }), 'all', now)
		).toBe(true);
	});

	it('matches only its own window otherwise', () => {
		expect(isInUpcomingWindow(soon, 'thisWeek', now)).toBe(true);
		expect(isInUpcomingWindow(soon, 'thisMonth', now)).toBe(false);
		expect(isInUpcomingWindow(soon, 'later', now)).toBe(false);
		expect(isInUpcomingWindow(soon, 'undated', now)).toBe(false);
	});

	it('excludes a title with nothing pending from every window', () => {
		for (const window of ['all', 'thisWeek', 'thisMonth', 'later', 'undated'] as const) {
			expect(isInUpcomingWindow(entry(), window, now)).toBe(false);
		}
	});
});

describe('countByUpcomingWindow', () => {
	/**
	 * The counts the filter chips wear. A chip that shows a number and then an
	 * empty grid is worse than no chip, so these come from the same predicate the
	 * filter itself uses.
	 */
	it('counts each window, and everything pending under "all"', () => {
		const counts = countByUpcomingWindow(
			[
				entry({ nextSeasonNumber: 2, nextSeasonAirDate: isoIn(2) }),
				entry({ nextSeasonNumber: 2, nextSeasonAirDate: isoIn(5) }),
				entry({ nextSeasonNumber: 2, nextSeasonAirDate: isoIn(20) }),
				entry({ nextSeasonNumber: 2, nextSeasonAirDate: isoIn(300) }),
				entry({ nextSeasonNumber: 2, nextSeasonAirDate: null }),
				entry()
			],
			now
		);

		expect(counts).toEqual({ all: 5, thisWeek: 2, thisMonth: 1, later: 1, undated: 1 });
	});

	it('counts nothing for a list with nothing pending', () => {
		expect(countByUpcomingWindow([entry()], now)).toEqual({
			all: 0,
			thisWeek: 0,
			thisMonth: 0,
			later: 0,
			undated: 0
		});
	});
});
