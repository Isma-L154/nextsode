import { describe, expect, it } from 'vitest';
import {
	daysUntilDeletion,
	isDeletable,
	isDueForDeletion,
	normalizeDeletionWindow,
	shouldWarnAboutDeletion,
	type DeletableEntry
} from './deletion';

const now = new Date('2026-08-12T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

const entry = (over: Partial<DeletableEntry> = {}): DeletableEntry => ({
	mediaType: 'movie',
	releaseDate: '2010-01-01',
	nextSeasonNumber: null,
	nextSeasonAirDate: null,
	watched: true,
	watchedAt: daysAgo(40),
	...over
});

describe('isDeletable', () => {
	it('accepts a watched film', () => {
		expect(isDeletable(entry(), now)).toBe(true);
	});

	it('ignores anything not watched', () => {
		expect(isDeletable(entry({ watched: false }), now)).toBe(false);
	});

	// Rows watched before the column existed have no clock to measure from.
	it('ignores entries with no watched timestamp', () => {
		expect(isDeletable(entry({ watchedAt: null }), now)).toBe(false);
	});

	/**
	 * The exclusion the whole design hangs on. Being caught up marks a running
	 * series watched, so without this the app would delete a show weeks before
	 * the season the viewer was waiting for.
	 */
	it('never touches a show with a season still to come', () => {
		expect(
			isDeletable(
				entry({ mediaType: 'tv', nextSeasonNumber: 23, nextSeasonAirDate: '2026-10-15' }),
				now
			)
		).toBe(false);
	});

	it('never touches a show whose next season has no date yet', () => {
		expect(
			isDeletable(entry({ mediaType: 'tv', nextSeasonNumber: 4, nextSeasonAirDate: null }), now)
		).toBe(false);
	});

	it('accepts a finished show with nothing pending', () => {
		expect(isDeletable(entry({ mediaType: 'tv' }), now)).toBe(true);
	});

	it('never touches an unreleased title', () => {
		expect(isDeletable(entry({ releaseDate: '2027-01-01' }), now)).toBe(false);
	});
});

describe('daysUntilDeletion', () => {
	it('is null when the feature is off', () => {
		expect(daysUntilDeletion(entry(), null, now)).toBeNull();
	});

	it('counts down from the watched date', () => {
		expect(daysUntilDeletion(entry({ watchedAt: daysAgo(0) }), 30, now)).toBe(30);
		expect(daysUntilDeletion(entry({ watchedAt: daysAgo(28) }), 30, now)).toBe(2);
	});

	it('floors at zero once overdue', () => {
		expect(daysUntilDeletion(entry({ watchedAt: daysAgo(45) }), 30, now)).toBe(0);
	});

	it('is null for anything the rules exclude', () => {
		expect(daysUntilDeletion(entry({ watched: false }), 30, now)).toBeNull();
	});
});

describe('isDueForDeletion', () => {
	it('is false before the window elapses and true after', () => {
		expect(isDueForDeletion(entry({ watchedAt: daysAgo(29) }), 30, now)).toBe(false);
		expect(isDueForDeletion(entry({ watchedAt: daysAgo(30) }), 30, now)).toBe(true);
	});

	it('is never true while the feature is off', () => {
		expect(isDueForDeletion(entry({ watchedAt: daysAgo(999) }), null, now)).toBe(false);
	});

	// The safety property, restated as a test because it is the one that matters.
	it('is never true for a show with a pending season, however old', () => {
		expect(
			isDueForDeletion(
				entry({
					mediaType: 'tv',
					watchedAt: daysAgo(999),
					nextSeasonNumber: 9,
					nextSeasonAirDate: '2027-01-01'
				}),
				7,
				now
			)
		).toBe(false);
	});
});

describe('shouldWarnAboutDeletion', () => {
	it('warns only inside the final week', () => {
		expect(shouldWarnAboutDeletion(entry({ watchedAt: daysAgo(20) }), 30, now)).toBe(false);
		expect(shouldWarnAboutDeletion(entry({ watchedAt: daysAgo(25) }), 30, now)).toBe(true);
	});

	/**
	 * The shortest window is seven days, so every entry under it is inside the
	 * warning band from the moment it is watched. Deleting something the card
	 * never warned about is the one outcome this feature must not produce.
	 */
	it('warns from day one on the shortest window', () => {
		expect(shouldWarnAboutDeletion(entry({ watchedAt: daysAgo(0) }), 7, now)).toBe(true);
	});
});

describe('normalizeDeletionWindow', () => {
	it('accepts the offered windows', () => {
		expect(normalizeDeletionWindow(7)).toBe(7);
		expect(normalizeDeletionWindow('30')).toBe(30);
		expect(normalizeDeletionWindow(90)).toBe(90);
	});

	it('rejects anything else, falling back to off', () => {
		expect(normalizeDeletionWindow(1)).toBeNull();
		expect(normalizeDeletionWindow(0)).toBeNull();
		expect(normalizeDeletionWindow(-30)).toBeNull();
		expect(normalizeDeletionWindow('soon')).toBeNull();
		expect(normalizeDeletionWindow(null)).toBeNull();
	});
});
