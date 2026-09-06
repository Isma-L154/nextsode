import { describe, expect, it } from 'vitest';
import {
	canMarkWatched,
	getReleaseInfo,
	isUpcoming,
	pendingReleaseLabel,
	releaseVerb
} from './release';

// Fixed "today" so every assertion is deterministic regardless of when CI runs.
const now = new Date('2026-07-29T12:00:00Z');

describe('getReleaseInfo — state', () => {
	it('treats a past date as released', () => {
		expect(getReleaseInfo('1999-03-31', now).state).toBe('released');
	});

	it('treats today as released', () => {
		expect(getReleaseInfo('2026-07-29', now).state).toBe('released');
	});

	it('treats a future date as upcoming', () => {
		expect(getReleaseInfo('2026-08-14', now).state).toBe('upcoming');
	});

	it('treats a missing date as unscheduled', () => {
		expect(getReleaseInfo(null, now)).toMatchObject({ state: 'unscheduled', shortLabel: 'TBA' });
		expect(getReleaseInfo('', now).state).toBe('unscheduled');
	});

	it('treats a malformed or impossible date as unscheduled', () => {
		expect(getReleaseInfo('not-a-date', now).state).toBe('unscheduled');
		expect(getReleaseInfo('2026-02-31', now).state).toBe('unscheduled');
	});

	it('accepts a year-only date, anchored to January 1st', () => {
		expect(getReleaseInfo('2027', now).state).toBe('upcoming');
		expect(getReleaseInfo('2020', now).state).toBe('released');
	});
});

describe('getReleaseInfo — countdown', () => {
	it('counts whole days until release', () => {
		expect(getReleaseInfo('2026-08-14', now).daysUntil).toBe(16);
	});

	it('is null for released titles', () => {
		expect(getReleaseInfo('2020-01-01', now).daysUntil).toBeNull();
	});

	it('ignores the time of day, so "tomorrow" stays tomorrow all day', () => {
		const lateAtNight = new Date('2026-07-29T23:59:00Z');
		expect(getReleaseInfo('2026-07-30', lateAtNight).daysUntil).toBe(1);
	});
});

describe('getReleaseInfo — labels', () => {
	it('says "Tomorrow" one day out', () => {
		expect(getReleaseInfo('2026-07-30', now).shortLabel).toBe('Tomorrow');
	});

	it('counts down within the next week', () => {
		expect(getReleaseInfo('2026-08-03', now).shortLabel).toBe('In 5 days');
	});

	it('drops the year for a date later this year', () => {
		expect(getReleaseInfo('2026-08-14', now).shortLabel).toBe('Aug 14');
	});

	it('keeps the year for a date in a following year', () => {
		expect(getReleaseInfo('2027-01-15', now).shortLabel).toBe('Jan 15, 2027');
	});

	it('keeps the exact day even for distant releases', () => {
		expect(getReleaseInfo('2028-05-04', now).shortLabel).toBe('May 4, 2028');
	});

	it('never invents a day TMDB did not give — month-only dates stay month-only', () => {
		expect(getReleaseInfo('2027-03', now).shortLabel).toBe('Mar 2027');
		expect(getReleaseInfo('2027-03', now).fullDate).toBe('March 2027');
	});

	it('never invents a day TMDB did not give — year-only dates stay year-only', () => {
		expect(getReleaseInfo('2029', now).shortLabel).toBe('2029');
		expect(getReleaseInfo('2029', now).fullDate).toBe('2029');
	});

	it('spells the date out in full for detail views', () => {
		expect(getReleaseInfo('2026-08-14', now).fullDate).toBe('Friday, August 14, 2026');
	});

	it('leaves the short label empty once released', () => {
		expect(getReleaseInfo('2020-01-01', now).shortLabel).toBe('');
	});
});

describe('isUpcoming', () => {
	it('is true only for confirmed future dates', () => {
		expect(isUpcoming('2026-12-25', now)).toBe(true);
		expect(isUpcoming('2020-12-25', now)).toBe(false);
		expect(isUpcoming(null, now)).toBe(false);
	});
});

describe('releaseVerb', () => {
	it('uses medium-appropriate wording', () => {
		expect(releaseVerb('movie')).toBe('In theaters');
		expect(releaseVerb('tv')).toBe('Premieres');
	});
});

describe('canMarkWatched', () => {
	it('allows anything already out', () => {
		expect(canMarkWatched('1999-03-31', now)).toBe(true);
		// Released today counts as released; see `getReleaseInfo`.
		expect(canMarkWatched('2026-07-29', now)).toBe(true);
	});

	it('refuses a confirmed future date', () => {
		expect(canMarkWatched('2026-07-30', now)).toBe(false);
		expect(canMarkWatched('2029-12-19', now)).toBe(false);
	});

	it('refuses a future date given only as a month or a year', () => {
		expect(canMarkWatched('2027-03', now)).toBe(false);
		expect(canMarkWatched('2028', now)).toBe(false);
	});

	/**
	 * The decision this rule turns on. "No date" means two opposite things — a
	 * production announced years out, and an obscure catalogue title nobody has
	 * dated — so refusing on it would lock a film somebody watched decades ago on
	 * the strength of a missing field.
	 */
	it('allows a title TMDB has no date for at all', () => {
		expect(canMarkWatched(null, now)).toBe(true);
		expect(canMarkWatched('', now)).toBe(true);
		expect(canMarkWatched('not-a-date', now)).toBe(true);
	});

	it('agrees with the badge the card already shows', () => {
		for (const date of ['1999-03-31', '2026-07-29', '2026-07-30', '2029-12-19', null]) {
			expect(canMarkWatched(date, now)).toBe(!isUpcoming(date, now));
		}
	});
});

describe('pendingReleaseLabel', () => {
	// "Aug 14" alone does not say whether a film opens or a series premieres.
	it('names the event as well as the date', () => {
		expect(pendingReleaseLabel('movie', '2026-08-14', now)).toBe('Out Aug 14');
		expect(pendingReleaseLabel('tv', '2026-08-14', now)).toBe('Premieres Aug 14');
	});

	/**
	 * The date, never the countdown. `shortLabel` becomes "In 3 days" inside the
	 * last week, and "In theaters In 3 days" reads like a typo — the countdown is
	 * on the poster badge directly above instead.
	 */
	it('gives the date even when the badge above is counting down', () => {
		expect(pendingReleaseLabel('movie', '2026-07-30', now)).toBe('Out Jul 30');
		expect(pendingReleaseLabel('tv', '2026-08-02', now)).toBe('Premieres Aug 2');
	});

	// The longest thing this slot can be asked to hold; it has to fit a poster
	// tile on a five-column grid without truncating.
	it('says only as much as the date does', () => {
		expect(pendingReleaseLabel('movie', '2027-03', now)).toBe('Out Mar 2027');
		expect(pendingReleaseLabel('tv', '2028', now)).toBe('Premieres 2028');
	});

	// Nothing to say means nothing shown: the card falls back to its real control.
	it('says nothing about a title that is out, or one with no date', () => {
		expect(pendingReleaseLabel('movie', '1999-03-31', now)).toBeNull();
		expect(pendingReleaseLabel('movie', null, now)).toBeNull();
	});
});
