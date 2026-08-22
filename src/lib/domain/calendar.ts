import type { Identifiable } from './media';
import { getUpcomingInfo, type UpcomingEntry } from './upcoming';

/**
 * Getting a watchlist's dates into somebody's calendar, in the two forms that
 * are actually reachable.
 *
 * A subscribable **iCalendar feed** for the whole list, and a **one-tap link**
 * for a single title. They share the date arithmetic and the wording, which is
 * why they share a module — and they exist together because each covers the
 * other's failure: the feed keeps up with changed dates but arrives on Google's
 * own slow schedule, and the link is instant but never looks back.
 *
 * All of it is pure and away from the route, so the format can be tested as a
 * format. Folding, escaping and line endings are the kind of thing that looks
 * right in a browser and then fails silently in somebody's calendar client.
 */

/** What one event needs from a saved row. */
export type CalendarEntry = UpcomingEntry & {
	tmdbId: number;
	title: string;
};

export interface CalendarOptions {
	/** Absolute origin, used to link each event back at the app. */
	origin: string;
	/** Fixed "now", so the same list always renders the same bytes. */
	now?: Date;
	/** Shown as the calendar's name by most clients. */
	name?: string;
}

/**
 * RFC 5545 counts **octets**, not characters, and a title with an accent or an
 * emoji in it is the case where those differ. Folding by `String.length` would
 * produce lines that are legal-looking and too long.
 */
const MAX_OCTETS = 75;

const encoder = new TextEncoder();

/**
 * Break one content line into 75-octet chunks, continuations indented by a
 * space. Splitting mid-codepoint would corrupt the character, so the cut is
 * taken at the last boundary that still fits.
 */
export function foldLine(line: string): string {
	if (encoder.encode(line).length <= MAX_OCTETS) return line;

	const out: string[] = [];
	// Continuation lines carry a leading space, which costs one of the 75.
	let limit = MAX_OCTETS;
	let current = '';
	let used = 0;

	for (const char of line) {
		const size = encoder.encode(char).length;
		if (used + size > limit) {
			out.push(current);
			current = '';
			used = 0;
			limit = MAX_OCTETS - 1;
		}
		current += char;
		used += size;
	}
	out.push(current);

	return out.join('\r\n ');
}

/**
 * Escape a TEXT value.
 *
 * Backslash first, or the escapes this adds would themselves be escaped. A
 * literal newline becomes `\n`, because a raw one would end the content line
 * and turn the rest of a description into a malformed property.
 */
export function escapeText(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r\n|\r|\n/g, '\\n');
}

/** `YYYY-MM-DD` → `YYYYMMDD`. */
function compactDate(iso: string): string {
	return iso.replace(/-/g, '');
}

/** The day after `iso`, as `YYYYMMDD` — DTEND on an all-day event is exclusive. */
function dayAfter(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	const next = new Date(Date.UTC(y, m - 1, d + 1));
	return next.toISOString().slice(0, 10).replace(/-/g, '');
}

/** UTC timestamp in the form `YYYYMMDDTHHMMSSZ`. */
function stamp(date: Date): string {
	return date
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');
}

/**
 * A stable identifier for an event.
 *
 * Stable is the whole point: a subscribed calendar is re-read repeatedly, and a
 * UID that changed between reads would leave the old event behind every time
 * TMDB moved a date — one film, four premiere dates in your calendar.
 */
function uid(entry: CalendarEntry, seasonNumber: number | null): string {
	const suffix = seasonNumber === null ? 'release' : `s${seasonNumber}`;
	return `${entry.mediaType}-${entry.tmdbId}-${suffix}@nextsode`;
}

function summaryFor(entry: CalendarEntry, seasonNumber: number | null): string {
	if (seasonNumber === null) return `${entry.title} — out today`;
	return `${entry.title} — season ${seasonNumber} premieres`;
}

/**
 * One VEVENT per title with a dated thing still ahead of it.
 *
 * Undated entries are skipped. The app can usefully say "announced, no date
 * yet"; a calendar cannot — there is no day to put it on, and inventing one
 * would be worse than the absence.
 */
function eventFor(entry: CalendarEntry, options: Required<CalendarOptions>): string[] | null {
	const upcoming = getUpcomingInfo(entry, options.now);
	if (!upcoming?.date) return null;

	const season = upcoming.seasonNumber;
	const path = `${options.origin}/?title=${entry.mediaType}-${entry.tmdbId}`;

	return [
		'BEGIN:VEVENT',
		`UID:${uid(entry, season)}`,
		`DTSTAMP:${stamp(options.now)}`,
		// VALUE=DATE, not a time. TMDB supplies a day; a timed event would be
		// inventing an hour, and it would land at the wrong one in half the world.
		`DTSTART;VALUE=DATE:${compactDate(upcoming.date)}`,
		`DTEND;VALUE=DATE:${dayAfter(upcoming.date)}`,
		`SUMMARY:${escapeText(summaryFor(entry, season))}`,
		`DESCRIPTION:${escapeText(`On your Nextsode watchlist.`)}`,
		`URL:${escapeText(path)}`,
		'TRANSP:TRANSPARENT',
		'END:VEVENT'
	];
}

/**
 * Render a whole calendar.
 *
 * Always returns a valid document, including for a list with nothing coming: an
 * empty calendar is a working subscription that will fill in later, whereas an
 * error is a subscription the client may stop retrying.
 */
export function buildCalendar(entries: readonly CalendarEntry[], options: CalendarOptions): string {
	const resolved: Required<CalendarOptions> = {
		origin: options.origin,
		now: options.now ?? new Date(),
		name: options.name ?? 'Nextsode'
	};

	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Nextsode//Watchlist//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		`X-WR-CALNAME:${escapeText(resolved.name)}`,
		'X-WR-CALDESC:Releases and season premieres from your Nextsode watchlist.',
		// A hint, not a promise: Google ignores it and refreshes when it likes.
		'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
		'X-PUBLISHED-TTL:PT12H'
	];

	for (const entry of entries) {
		const event = eventFor(entry, resolved);
		if (event) lines.push(...event);
	}

	lines.push('END:VCALENDAR');

	// CRLF throughout, and a trailing one: RFC 5545 ends every content line,
	// including the last.
	return lines.map(foldLine).join('\r\n') + '\r\n';
}

/**
 * A link that opens Google Calendar with the event already filled in.
 *
 * Returns null when there is nothing dated to add, so the caller can decide not
 * to render a control rather than render one that goes nowhere.
 *
 * This asks for no account, no scope and no token — it is a URL. Which is also
 * its limit: what it creates is a copy, and a copy does not follow TMDB when a
 * release slips. The feed is what keeps up.
 */
export function googleCalendarUrl(
	entry: CalendarEntry,
	options: { origin: string; now?: Date }
): string | null {
	const upcoming = getUpcomingInfo(entry, options.now ?? new Date());
	if (!upcoming?.date) return null;

	const url = new URL('https://calendar.google.com/calendar/render');
	url.searchParams.set('action', 'TEMPLATE');
	url.searchParams.set('text', summaryFor(entry, upcoming.seasonNumber));
	// Same all-day, end-exclusive span the feed uses, so the two agree.
	url.searchParams.set('dates', `${compactDate(upcoming.date)}/${dayAfter(upcoming.date)}`);
	url.searchParams.set(
		'details',
		`On your Nextsode watchlist: ${options.origin}/?title=${entry.mediaType}-${entry.tmdbId}`
	);
	return url.toString();
}

/**
 * The `?title=` a calendar event links back to, as something openable.
 *
 * Lives beside the builder rather than near the page, so the two sides of the
 * link cannot drift apart: whatever `googleCalendarUrl` and the feed write,
 * this is what reads it.
 *
 * Deliberately strict. The value arrives from outside — a calendar entry that
 * may be years old, a pasted link, a typo — so anything that is not exactly one
 * of the two media types followed by a positive integer is treated as absent
 * rather than half-understood.
 */
export function parseTitleParam(value: string | null): Identifiable | null {
	if (!value) return null;

	const match = /^(movie|tv)-(\d{1,12})$/.exec(value);
	if (!match) return null;

	const tmdbId = Number(match[2]);
	if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return null;

	return { tmdbId, mediaType: match[1] as Identifiable['mediaType'] };
}

/**
 * The two one-tap ways to subscribe to a feed, given its address.
 *
 * Subscribing used to read: copy this URL, open Google Calendar, find "Other
 * calendars → From URL", paste. Four steps and a menu most people have never
 * opened. These are the same thing as a link.
 *
 * `google` hands the feed to Google Calendar, which asks the visitor to confirm
 * before adding anything — no scope, no token, nothing granted to us.
 *
 * `webcal` is the same URL under the scheme that calendar apps register
 * themselves as handlers for. On iOS and macOS it opens Calendar directly;
 * Outlook takes it too. It does nothing useful on a desktop with no calendar
 * app installed, which is why it is offered beside the Google link rather than
 * instead of it — and why the raw URL stays on screen for everything else.
 */
export function subscribeLinks(feedUrl: string): { google: string; webcal: string } {
	return {
		google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedUrl)}`,
		// Scheme swap only. Anything cleverer would have to keep a second copy of
		// the address in step with the first.
		webcal: feedUrl.replace(/^https?:/, 'webcal:')
	};
}
