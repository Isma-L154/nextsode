import { describe, expect, it } from 'vitest';
import {
	buildCalendar,
	escapeText,
	foldLine,
	googleCalendarUrl,
	parseTitleParam,
	subscribeLinks,
	type CalendarEntry
} from './calendar';

const NOW = new Date('2026-08-20T12:00:00Z');

/** Every content line ends with one, and folding continues with one. */
const CRLF = '\r\n';

const film = (over: Partial<CalendarEntry> = {}): CalendarEntry => ({
	tmdbId: 27205,
	title: 'Inception',
	mediaType: 'movie',
	releaseDate: '2026-09-15',
	nextSeasonNumber: null,
	nextSeasonAirDate: null,
	...over
});

const show = (over: Partial<CalendarEntry> = {}): CalendarEntry => ({
	tmdbId: 87739,
	title: 'Silo',
	mediaType: 'tv',
	releaseDate: '2023-05-05',
	nextSeasonNumber: 3,
	nextSeasonAirDate: '2026-11-20',
	...over
});

const lines = (ics: string) => ics.split(CRLF);
const find = (ics: string, prefix: string) => lines(ics).filter((line) => line.startsWith(prefix));

describe('foldLine', () => {
	it('leaves a line that already fits alone', () => {
		expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
	});

	it('folds past 75 octets, continuing with a space', () => {
		const folded = foldLine('SUMMARY:' + 'a'.repeat(200));
		const parts = folded.split(CRLF);

		expect(parts.length).toBeGreaterThan(1);
		expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
		expect(parts.map((p) => p.replace(/^ /, '')).join('')).toBe('SUMMARY:' + 'a'.repeat(200));
	});

	it('counts octets, not characters', () => {
		// 40 CJK characters are 40 by `.length` and 120 octets. Folding by length
		// would call this short enough and emit a line nearly twice the limit.
		const cjk = String.fromCodePoint(0x6f22).repeat(40);
		const folded = foldLine('SUMMARY:' + cjk);

		expect(folded.split(CRLF).length).toBeGreaterThan(1);
		for (const part of folded.split(CRLF)) {
			expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
		}
	});

	it('never splits a character in half', () => {
		// An emoji is one codepoint and four octets, so a boundary that lands
		// inside it is easy to hit and produces two replacement characters that
		// no calendar client can undo.
		const emoji = String.fromCodePoint(0x1f680);
		const line = 'SUMMARY:' + emoji.repeat(30);
		const rejoined = foldLine(line)
			.split(CRLF)
			.map((part) => part.replace(/^ /, ''))
			.join('');

		expect(rejoined).toBe(line);
		expect(rejoined.includes(String.fromCodePoint(0xfffd))).toBe(false);
	});
});

describe('escapeText', () => {
	it('escapes the four characters that would otherwise end the value', () => {
		expect(escapeText('a,b')).toBe('a' + '\\' + ',b');
		expect(escapeText('a;b')).toBe('a' + '\\' + ';b');
		expect(escapeText('a' + '\\' + 'b')).toBe('a' + '\\' + '\\' + 'b');
		expect(escapeText('a\nb')).toBe('a' + '\\' + 'nb');
	});

	it('escapes the backslash before the escapes it adds', () => {
		// The other order would double-escape its own output.
		expect(escapeText('\\' + ',')).toBe('\\' + '\\' + '\\' + ',');
	});

	it('handles CRLF as one break, not two', () => {
		expect(escapeText('a\r\nb')).toBe('a' + '\\' + 'nb');
	});
});

describe('buildCalendar', () => {
	const opts = { origin: 'https://example.test', now: NOW };

	it('emits a valid, empty calendar for a list with nothing coming', () => {
		const ics = buildCalendar([], opts);

		// Not a 404 and not an error: a subscription that works and fills in later.
		expect(ics.startsWith('BEGIN:VCALENDAR' + '\r\n')).toBe(true);
		expect(ics.endsWith('END:VCALENDAR' + '\r\n')).toBe(true);
		expect(find(ics, 'BEGIN:VEVENT')).toHaveLength(0);
	});

	it('ends every line with CRLF, including the last', () => {
		const ics = buildCalendar([film()], opts);

		expect(ics.endsWith('\r\n')).toBe(true);
		expect(ics.includes('\n' + '\n')).toBe(false);
		for (const line of ics.split(CRLF).slice(0, -1)) {
			expect(line.endsWith('\r')).toBe(false);
		}
	});

	it('gives an unreleased film one all-day event on its release date', () => {
		const ics = buildCalendar([film()], opts);

		expect(find(ics, 'BEGIN:VEVENT')).toHaveLength(1);
		expect(find(ics, 'DTSTART')).toEqual(['DTSTART;VALUE=DATE:20260915']);
		// DTEND on an all-day event is exclusive, so it is the following day.
		expect(find(ics, 'DTEND')).toEqual(['DTEND;VALUE=DATE:20260916']);
		expect(find(ics, 'SUMMARY:')[0]).toContain('Inception');
	});

	it('gives a returning show its season premiere, not its original release', () => {
		const ics = buildCalendar([show()], opts);

		expect(find(ics, 'DTSTART')).toEqual(['DTSTART;VALUE=DATE:20261120']);
		expect(find(ics, 'SUMMARY:')[0]).toContain('season 3');
	});

	it('says nothing about a title with nothing ahead of it', () => {
		const done = show({ nextSeasonNumber: null, nextSeasonAirDate: null });
		expect(find(buildCalendar([done], opts), 'BEGIN:VEVENT')).toHaveLength(0);
	});

	it('skips an announced title with no date', () => {
		// The app can say "no date yet". A calendar has no day to put that on, and
		// inventing one would be worse than leaving it out.
		const undated = film({ releaseDate: null });
		expect(find(buildCalendar([undated], opts), 'BEGIN:VEVENT')).toHaveLength(0);
	});

	it('keeps a UID stable when the date moves', () => {
		const before = find(buildCalendar([film()], opts), 'UID:');
		const after = find(buildCalendar([film({ releaseDate: '2026-10-01' })], opts), 'UID:');

		// A changing UID would leave the old event behind every time TMDB shifted a
		// date: one film, four premieres in your calendar.
		expect(after).toEqual(before);
	});

	it('names the two kinds of event apart', () => {
		const ics = buildCalendar([film(), show()], opts);

		// Pinned rather than merely "different": the suffix is what will keep a
		// premiere and, one day, an episode from colliding on the same title.
		expect(find(ics, 'UID:')).toEqual([
			'UID:movie-27205-release@nextsode',
			'UID:tv-87739-s3@nextsode'
		]);
	});

	it('survives a title containing the characters that end a value', () => {
		const awkward = film({ title: 'Cloud, Atlas; part' + '\\' + '2' });
		const ics = buildCalendar([awkward], opts);
		const summary = find(ics, 'SUMMARY:')[0];

		expect(summary).toContain('\\' + ',');
		expect(summary).toContain('\\' + ';');
		expect(summary).toContain('\\' + '\\');
	});

	it('folds a long title rather than emitting an over-long line', () => {
		const ics = buildCalendar([film({ title: 'A'.repeat(300) })], opts);

		for (const line of ics.split(CRLF)) {
			expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
		}
	});

	it('renders the same bytes twice for the same input', () => {
		// `now` is injected rather than read, so the endpoint is cacheable and this
		// test cannot pass by accident on a fast machine.
		expect(buildCalendar([film(), show()], opts)).toBe(buildCalendar([film(), show()], opts));
	});
});

describe('googleCalendarUrl', () => {
	const opts = { origin: 'https://example.test', now: NOW };

	it('builds a prefilled Google Calendar link for an unreleased film', () => {
		const url = new URL(googleCalendarUrl(film(), opts) as string);

		expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
		expect(url.searchParams.get('action')).toBe('TEMPLATE');
		expect(url.searchParams.get('text')).toContain('Inception');
		// End-exclusive, matching the feed, so the two never disagree about which
		// day a release lands on.
		expect(url.searchParams.get('dates')).toBe('20260915/20260916');
	});

	it('uses the season premiere for a returning show', () => {
		const url = new URL(googleCalendarUrl(show(), opts) as string);

		expect(url.searchParams.get('dates')).toBe('20261120/20261121');
		expect(url.searchParams.get('text')).toContain('season 3');
	});

	it('answers null when there is nothing to add', () => {
		// So the caller can decline to render a control, rather than render one
		// that leads somewhere empty.
		expect(googleCalendarUrl(film({ releaseDate: null }), opts)).toBeNull();
		expect(
			googleCalendarUrl(show({ nextSeasonNumber: null, nextSeasonAirDate: null }), opts)
		).toBeNull();
	});

	it('encodes a title that would otherwise break the query string', () => {
		const url = googleCalendarUrl(film({ title: 'Am&lie: a "story", 100%' }), opts) as string;

		expect(url).not.toContain(' ');
		expect(new URL(url).searchParams.get('text')).toContain('Am&lie: a "story", 100%');
	});

	it('agrees with the feed about the day', () => {
		const ics = buildCalendar([film()], opts);
		const dtstart = find(ics, 'DTSTART')[0].split(':')[1];
		const dates = new URL(googleCalendarUrl(film(), opts) as string).searchParams.get('dates');

		expect(dates?.startsWith(dtstart)).toBe(true);
	});
});

describe('parseTitleParam', () => {
	it('reads what the link builder writes', () => {
		const url = new URL(
			googleCalendarUrl(show(), { origin: 'https://x.test', now: NOW }) as string
		);
		const details = url.searchParams.get('details') as string;
		const value = new URL(details.slice(details.indexOf('https://'))).searchParams.get('title');

		// The two halves of the round-trip, checked against each other rather than
		// against a string typed twice.
		expect(parseTitleParam(value)).toEqual({ tmdbId: 87739, mediaType: 'tv' });
	});

	it('accepts both media types', () => {
		expect(parseTitleParam('movie-27205')).toEqual({ tmdbId: 27205, mediaType: 'movie' });
		expect(parseTitleParam('tv-1')).toEqual({ tmdbId: 1, mediaType: 'tv' });
	});

	it('treats anything it does not fully understand as absent', () => {
		// This value arrives from outside — a years-old calendar entry, a pasted
		// link, a typo — so half-understanding it is the one thing not to do.
		for (const bad of [
			null,
			'',
			'movie',
			'movie-',
			'-27205',
			'book-27205',
			'movie-abc',
			'movie-27205-extra',
			'movie-0',
			'movie--1',
			'movie-1.5',
			' movie-1',
			'MOVIE-1',
			'movie-1234567890123'
		]) {
			expect(parseTitleParam(bad)).toBeNull();
		}
	});
});

describe('subscribeLinks', () => {
	const FEED = 'https://nextsode.cloudils.com/calendar/abc123.ics';

	it('hands the feed to Google Calendar', () => {
		const url = new URL(subscribeLinks(FEED).google);

		expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/r');
		expect(url.searchParams.get('cid')).toBe(FEED);
	});

	it('encodes the feed so the query cannot be broken by it', () => {
		// The token is hex today, but the address is built from an origin and a
		// path and neither is this function's to assume.
		const awkward = 'https://example.test/calendar/a+b c&d.ics';
		const url = new URL(subscribeLinks(awkward).google);

		expect(url.searchParams.get('cid')).toBe(awkward);
		expect(subscribeLinks(awkward).google).not.toContain(' ');
	});

	it('offers the same feed under the scheme calendar apps answer to', () => {
		expect(subscribeLinks(FEED).webcal).toBe('webcal://nextsode.cloudils.com/calendar/abc123.ics');
	});

	it('swaps the scheme on a plain http feed too', () => {
		// Local development serves the feed over http, and a link that silently
		// did nothing there would be found late.
		expect(subscribeLinks('http://localhost:5173/calendar/x.ics').webcal).toBe(
			'webcal://localhost:5173/calendar/x.ics'
		);
	});

	it('changes nothing but the scheme', () => {
		const { webcal } = subscribeLinks(FEED);

		expect(webcal.slice('webcal:'.length)).toBe(FEED.slice('https:'.length));
	});
});
