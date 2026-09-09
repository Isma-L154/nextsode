import { getReleaseInfo } from './release';
import type { WatchlistEntry } from './watchlist';

/**
 * "What is still coming" for a saved title.
 *
 * There are two different pending things and the list previously only knew about
 * one. A film that has not opened is pending because of its release date; a
 * returning series is pending because of its *next season*, and its release date
 * is years in the past. Judging by release date alone meant a show with a season
 * premiering next month was absent from the one view built to answer "what am I
 * waiting for".
 */

export type UpcomingKind = 'release' | 'season';

export interface UpcomingInfo {
	kind: UpcomingKind;
	/** `YYYY-MM-DD`, or null when it is announced but unscheduled. */
	date: string | null;
	/** Whole days from today; null when there is no date. */
	daysUntil: number | null;
	/** Compact date text, e.g. "Tomorrow", "Oct 15". */
	shortLabel: string;
	/** Full sentence for detail views. */
	fullDate: string;
	/** Which season is coming; null for a film release. */
	seasonNumber: number | null;
}

/** The fields this reasoning needs — a subset of a watchlist row. */
export type UpcomingEntry = Pick<
	WatchlistEntry,
	'mediaType' | 'releaseDate' | 'nextSeasonNumber' | 'nextSeasonAirDate'
>;

/**
 * What this entry is still waiting on, or null when nothing.
 *
 * The title's own release wins over a pending season: a show that has not
 * premiered at all is waiting on its premiere, not on "season 2".
 */
export function getUpcomingInfo(entry: UpcomingEntry, now: Date = new Date()): UpcomingInfo | null {
	const release = getReleaseInfo(entry.releaseDate, now);
	if (release.state !== 'released') {
		return {
			kind: 'release',
			date: entry.releaseDate,
			daysUntil: release.daysUntil,
			shortLabel: release.shortLabel,
			fullDate: release.fullDate,
			seasonNumber: null
		};
	}

	if (entry.mediaType !== 'tv' || entry.nextSeasonNumber === null) return null;

	const season = getReleaseInfo(entry.nextSeasonAirDate, now);
	if (season.state === 'released') return null;

	return {
		kind: 'season',
		date: entry.nextSeasonAirDate,
		daysUntil: season.daysUntil,
		shortLabel: season.shortLabel,
		fullDate: season.fullDate,
		seasonNumber: entry.nextSeasonNumber
	};
}

/**
 * Whether anything is still to come for this entry.
 *
 * Deliberately includes announced-but-undated titles. They are not watchable, so
 * grouping them with everything else already released would be wrong — and
 * "announced, no date yet" is a useful thing for the view to be able to say.
 */
export function hasUpcoming(entry: UpcomingEntry, now: Date = new Date()): boolean {
	return getUpcomingInfo(entry, now) !== null;
}

/** Ordering key for "soonest first"; undated entries sort last. */
export function upcomingSortKey(entry: UpcomingEntry, now: Date = new Date()): number {
	const info = getUpcomingInfo(entry, now);
	return info?.daysUntil ?? Number.POSITIVE_INFINITY;
}

export type UpcomingWindow = 'thisWeek' | 'thisMonth' | 'later' | 'undated';

/** The windows plus the unfiltered view, in the order the filter offers them. */
export type UpcomingFilter = 'all' | UpcomingWindow;

export const UPCOMING_FILTERS: readonly UpcomingFilter[] = [
	'all',
	'thisWeek',
	'thisMonth',
	'later',
	'undated'
];

export const UPCOMING_FILTER_LABELS: Record<UpcomingFilter, string> = {
	all: 'All',
	thisWeek: 'This week',
	thisMonth: 'This month',
	later: 'Later',
	undated: 'No date'
};

/** Bucket boundaries in days. A "month" is 31 so a 30-day month never spills. */
const THIS_WEEK_DAYS = 7;
const THIS_MONTH_DAYS = 31;

/**
 * Which window a pending title falls in, or null when nothing is pending.
 *
 * These used to be headings that split the view into one grid per window, which
 * is what broke it: a handful of titles spread across four windows rendered as
 * four rows of one card. They are a *filter* now — one grid, narrowed on demand
 * — so this answers a question about a single title rather than partitioning a
 * list.
 */
export function upcomingWindowFor(
	entry: UpcomingEntry,
	now: Date = new Date()
): UpcomingWindow | null {
	const info = getUpcomingInfo(entry, now);
	if (!info) return null;
	if (info.daysUntil === null) return 'undated';
	if (info.daysUntil <= THIS_WEEK_DAYS) return 'thisWeek';
	if (info.daysUntil <= THIS_MONTH_DAYS) return 'thisMonth';
	return 'later';
}

/**
 * Whether a title belongs in the chosen filter.
 *
 * `all` still excludes titles with nothing pending: the filter narrows the
 * Upcoming view, it does not define it.
 */
export function isInUpcomingWindow(
	entry: UpcomingEntry,
	filter: UpcomingFilter,
	now: Date = new Date()
): boolean {
	const window = upcomingWindowFor(entry, now);
	if (window === null) return false;
	return filter === 'all' || window === filter;
}

/** How many pending titles sit in each window, for the numbers on the chips. */
export function countByUpcomingWindow(
	items: readonly UpcomingEntry[],
	now: Date = new Date()
): Record<UpcomingFilter, number> {
	const counts: Record<UpcomingFilter, number> = {
		all: 0,
		thisWeek: 0,
		thisMonth: 0,
		later: 0,
		undated: 0
	};

	for (const item of items) {
		const window = upcomingWindowFor(item, now);
		if (window === null) continue;
		counts.all++;
		counts[window]++;
	}

	return counts;
}
