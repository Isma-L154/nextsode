import type { MediaType } from '../types';

/**
 * Release-date reasoning, kept pure and framework-agnostic so it can be unit
 * tested and reused by every view.
 *
 * TMDB happily returns titles that are still in production, so the UI has to be
 * able to say "this isn't out yet, here's when it lands" instead of silently
 * showing a future year like any other.
 */

export type ReleaseState =
	/** Already out. */
	| 'released'
	/** Has a confirmed future date. */
	| 'upcoming'
	/** No date from TMDB at all — announced but unscheduled. */
	| 'unscheduled';

export interface ReleaseInfo {
	state: ReleaseState;
	/** Whole days from today until release; null unless `state === 'upcoming'`. */
	daysUntil: number | null;
	/** Compact badge text, e.g. "Tomorrow", "In 5 days", "Aug 14", "Mar 2027". */
	shortLabel: string;
	/**
	 * The date itself, always, at the precision it was given: "Aug 14",
	 * "Mar 2027", "2028".
	 *
	 * `shortLabel` turns into a countdown inside the last week, which is the
	 * friendlier thing on a badge and the wrong thing to put after a verb —
	 * "In theaters In 3 days" reads like a typo. Empty unless there is a date.
	 */
	shortDate: string;
	/** Full sentence for detail views, e.g. "Friday, August 14, 2026". */
	fullDate: string;
}

const MS_PER_DAY = 86_400_000;

/**
 * Classify a TMDB date string (`YYYY-MM-DD`, sometimes partial or empty).
 *
 * Dates are compared as calendar days in UTC rather than as instants: a film
 * released "on August 14" is out on August 14 everywhere, and anchoring both
 * sides to UTC midnight stops the countdown flickering by ±1 across time zones.
 */
export function getReleaseInfo(releaseDate: string | null, now: Date = new Date()): ReleaseInfo {
	const parsed = parseReleaseDate(releaseDate);
	if (parsed === null) {
		return {
			state: 'unscheduled',
			daysUntil: null,
			shortLabel: 'TBA',
			shortDate: '',
			fullDate: ''
		};
	}

	const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
	const daysUntil = Math.round((parsed.timestamp - todayUtc) / MS_PER_DAY);
	const date = new Date(parsed.timestamp);
	const fullDate = formatDate(date, parsed.precision, now.getFullYear(), true);
	const shortDate = formatDate(date, parsed.precision, now.getFullYear(), false);

	if (daysUntil <= 0) {
		return { state: 'released', daysUntil: null, shortLabel: '', shortDate, fullDate };
	}

	return {
		state: 'upcoming',
		daysUntil,
		shortLabel: formatShort(date, parsed.precision, daysUntil, now.getFullYear()),
		shortDate,
		fullDate
	};
}

/** Convenience predicate for filtering and counting. */
export function isUpcoming(releaseDate: string | null, now: Date = new Date()): boolean {
	return getReleaseInfo(releaseDate, now).state === 'upcoming';
}

/**
 * Wording for the release line. Cinema releases and TV premieres are different
 * enough events that reusing one verb for both reads wrong.
 */
export function releaseVerb(mediaType: MediaType): string {
	return mediaType === 'tv' ? 'Premieres' : 'In theaters';
}

/** How specific the source date actually was. */
type DatePrecision = 'day' | 'month' | 'year';

interface ParsedDate {
	timestamp: number;
	precision: DatePrecision;
}

/**
 * Parse a TMDB date into a UTC timestamp, remembering how specific it was.
 *
 * Titles far from release are often listed with only a year or a month. Those
 * are anchored to the 1st so they can still be compared and sorted, but the
 * precision is tracked so the UI never invents a day that was never announced.
 */
function parseReleaseDate(value: string | null): ParsedDate | null {
	if (!value) return null;

	const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value.trim());
	if (!match) return null;

	const year = Number(match[1]);
	const month = match[2] ? Number(match[2]) - 1 : 0;
	const day = match[3] ? Number(match[3]) : 1;

	const timestamp = Date.UTC(year, month, day);
	// Reject impossible dates like 2026-02-31, which Date.UTC would roll over.
	const parsed = new Date(timestamp);
	if (parsed.getUTCMonth() !== month || parsed.getUTCDate() !== day) return null;

	const precision: DatePrecision = match[3] ? 'day' : match[2] ? 'month' : 'year';
	return { timestamp, precision };
}

/**
 * Short label tuned to distance: within a week a countdown is more meaningful
 * than a date, beyond that the date itself is what people want to know.
 */
function formatShort(
	date: Date,
	precision: DatePrecision,
	daysUntil: number,
	currentYear: number
): string {
	if (daysUntil === 1) return 'Tomorrow';
	if (daysUntil <= 7 && precision === 'day') return `In ${daysUntil} days`;
	return formatDate(date, precision, currentYear, false);
}

/**
 * Render a date at the precision it was given, dropping the year when it is the
 * current one — "Aug 14" is less noisy than "Aug 14, 2026" and just as clear.
 */
function formatDate(
	date: Date,
	precision: DatePrecision,
	currentYear: number,
	long: boolean
): string {
	const year = date.getUTCFullYear() === currentYear ? undefined : ('numeric' as const);
	const month = long ? ('long' as const) : ('short' as const);

	if (precision === 'year') return String(date.getUTCFullYear());
	if (precision === 'month') return format(date, { month, year: 'numeric' });
	return format(date, {
		weekday: long ? 'long' : undefined,
		month,
		day: 'numeric',
		year: long ? 'numeric' : year
	});
}

function format(date: Date, options: Intl.DateTimeFormatOptions): string {
	return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(date);
}

/**
 * Whether a title may be marked as watched yet.
 *
 * The app already refuses to let a show be ticked past its aired seasons — you
 * cannot have watched what has not been broadcast — and this is the same rule
 * for the other half of the library. Without it "Watched" sits on a film that
 * opens next spring, which is either a mistake waiting to happen or a note the
 * list has no way to interpret.
 *
 * Only a confirmed future date refuses. `unscheduled` — TMDB holding no date at
 * all — deliberately does not, because that state means two opposite things: a
 * production announced years out, and an obscure catalogue title nobody has
 * dated. Refusing on it would lock a film somebody watched decades ago on the
 * strength of a missing field. Not knowing when something came out is not the
 * same as knowing it has not.
 *
 * Marking something *un*watched is never blocked; see `toggleWatched`. This
 * governs the way in, not the way back out, so a row that predates the rule is
 * never stranded.
 */
export function canMarkWatched(releaseDate: string | null, now: Date = new Date()): boolean {
	return !isUpcoming(releaseDate, now);
}

/**
 * The compact verb, for the one slot that has no room for `releaseVerb`.
 *
 * "In theaters Mar 2027" overflows a poster tile on a five-column grid and
 * truncates to "In theaters Mar 20…", which loses the only part that was worth
 * saying. "Out" costs eight characters and no meaning: the tile already wears a
 * FILM or TV badge, so the verb is not what distinguishes them here — it is only
 * there to stop a bare date reading as a year of production.
 */
function compactReleaseVerb(mediaType: MediaType): string {
	return mediaType === 'tv' ? 'Premieres' : 'Out';
}

/**
 * What the card says where the "Watched" button would have been.
 *
 * The verb matters as much as the date: "Aug 14" alone does not say whether a
 * film opens or a series premieres, and the card has room for exactly one line.
 *
 * The date rather than `shortLabel`, which becomes a countdown inside the last
 * week and would read "Out In 3 days". The countdown is not lost — it is on the
 * poster badge directly above, which is the better place for it: one glance says
 * how soon, the line underneath says what and when.
 */
export function pendingReleaseLabel(
	mediaType: MediaType,
	releaseDate: string | null,
	now: Date = new Date()
): string | null {
	const release = getReleaseInfo(releaseDate, now);
	if (release.state !== 'upcoming') return null;
	return `${compactReleaseVerb(mediaType)} ${release.shortDate}`;
}
