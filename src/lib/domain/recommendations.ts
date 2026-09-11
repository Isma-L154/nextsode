import { mediaKey, uniqueBy } from './media';
import { hasStarted } from './episodes';
import type { MediaResult, MediaType } from '../types';

/**
 * "Because you watched X" — discovery built from the list rather than from what
 * is popular this week, which is the same twenty titles for everybody and so
 * the one part of Discover that cannot improve with use.
 *
 * Pure: which titles are worth asking about, and what survives the answers. The
 * requests themselves belong to the loader.
 */

/** The columns seed selection reads — structurally a subset of a watchlist row. */
export interface SeedCandidate {
	tmdbId: number;
	mediaType: MediaType;
	title: string;
	watched: boolean;
	seasonsSeen: number;
	episodesIntoSeason: number;
	addedAt: Date;
	watchedAt: Date | null;
}

/**
 * How the seed came to be one, which is how the row gets worded. Telling
 * somebody they "saved" a show they are four episodes into is defensible and
 * still reads as the app not having noticed.
 */
export type SeedState = 'watched' | 'watching' | 'saved';

/** One rendered row: a title from the list, and what it suggests. */
export interface RecommendationRail {
	/** The saved title the row is explained by. */
	seedTitle: string;
	seedState: SeedState;
	/** Stable `{#each}` key, since two rails can never share a seed. */
	seedKey: string;
	items: MediaResult[];
}

/** Requested in parallel, so the third costs no wall-clock time — it is a spare. */
const MAX_SEEDS = 3;

/** How many rows to render. Two is enough to be useful without burying trending. */
const MAX_RAILS = 2;

/** Below this a row looks like a mistake rather than a suggestion. */
export const MIN_RAIL_ITEMS = 4;

/**
 * A rail is a glance, not a catalogue.
 *
 * Two rows of twelve was more scrolling than either row earned, and TMDB ranks
 * its suggestions — so the tail was the weakest half of an already secondary
 * section.
 */
const MAX_RAIL_ITEMS = 8;

/**
 * Whether a title says anything about taste. Saving is a guess; watching is a
 * verdict — and seeding from verdicts is what keeps the rows still, since
 * saving a title then cannot reshuffle the section under the reader.
 */
function isEngaged(row: SeedCandidate): boolean {
	return row.watched || hasStarted(row);
}

/** Which of the three claims holds for a seed. */
export function seedState(row: SeedCandidate): SeedState {
	if (row.watched) return 'watched';
	return hasStarted(row) ? 'watching' : 'saved';
}

/** Milliseconds, with a null date sorting as "long ago" rather than as now. */
function time(date: Date | null): number {
	return date ? date.getTime() : 0;
}

/**
 * Most recent verdict first, falling back to the most recent guess. A show
 * finished last month describes taste better than one added this morning.
 */
function compareSeeds(a: SeedCandidate, b: SeedCandidate): number {
	const engagedA = isEngaged(a);
	if (engagedA !== isEngaged(b)) return engagedA ? -1 : 1;
	if (engagedA) return time(b.watchedAt ?? b.addedAt) - time(a.watchedAt ?? a.addedAt);
	return time(b.addedAt) - time(a.addedAt);
}

/**
 * Which day it is where the viewer is, as a plain count of days.
 *
 * The rows turn over at local midnight, so the boundary has to be the viewer's,
 * not the server's — a Worker runs in UTC, which for most of the world is the
 * middle of an afternoon or the small hours. Formatting to `YYYY-MM-DD` in the
 * target zone and counting from there sidesteps every offset and DST rule,
 * because the calendar date is exactly the question being asked.
 *
 * An unusable zone falls back to UTC rather than throwing: the wrong midnight is
 * a shrug, a crashed page is not.
 */
export function dayNumber(now: Date, timeZone: string): number {
	let localDate: string;
	try {
		// `en-CA` is the locale that formats as YYYY-MM-DD.
		localDate = new Intl.DateTimeFormat('en-CA', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(now);
	} catch {
		localDate = now.toISOString().slice(0, 10);
	}

	return Math.floor(Date.parse(`${localDate}T00:00:00Z`) / 86_400_000);
}

/** Move the first `by` entries to the back, wrapping. */
function rotate<T>(items: readonly T[], by: number): T[] {
	if (items.length === 0) return [];
	const offset = ((by % items.length) + items.length) % items.length;
	return [...items.slice(offset), ...items.slice(0, offset)];
}

/**
 * Choose which saved titles to ask about, for a given day.
 *
 * Ranking picks the *best* seeds; rotation stops the same two winning forever.
 * A list of twenty watched titles has plenty to say and would otherwise say the
 * same thing every visit, so the engaged pool is walked one day at a time and
 * the rows turn over at midnight without anything having to run at midnight.
 *
 * Only the engaged pool rotates. Letting the rotation run off the end of it
 * would eventually seed a day entirely from titles nobody has touched, which is
 * a worse row than a repeated one — untouched saves are the fallback, never the
 * scheduled turn.
 *
 * A brand-new list has nothing engaged with yet and falls through to the most
 * recently added. Those rows churn while the list is two titles long, which is
 * the one moment it costs nothing.
 */
export function pickSeeds(
	rows: readonly SeedCandidate[],
	limit = MAX_SEEDS,
	day = 0
): SeedCandidate[] {
	const ranked = [...rows].sort(compareSeeds);
	const engaged = ranked.filter(isEngaged);
	const untouched = ranked.filter((row) => !isEngaged(row));

	return [...rotate(engaged, day), ...untouched].slice(0, limit);
}

/** What one seed's lookup came back with. */
export interface SeedResult {
	seed: SeedCandidate;
	items: readonly MediaResult[];
}

export interface RailOptions {
	maxRails?: number;
	minItems?: number;
	maxItems?: number;
}

/**
 * Turn raw lookups into the rows to render.
 *
 * Two filters do the work. Already-saved titles go, including ones an earlier
 * row already suggested, so two rows never overlap. Poster-less titles go too:
 * a placeholder in a wall of artwork reads as broken rather than as missing.
 *
 * A row left too thin is discarded whole — no row is a cleaner answer than a
 * row of three under a heading.
 */
export function buildRails(
	results: readonly SeedResult[],
	savedKeys: ReadonlySet<string>,
	options: RailOptions = {}
): RecommendationRail[] {
	const { maxRails = MAX_RAILS, minItems = MIN_RAIL_ITEMS, maxItems = MAX_RAIL_ITEMS } = options;

	const used = new Set(savedKeys);
	const rails: RecommendationRail[] = [];

	for (const { seed, items } of results) {
		if (rails.length >= maxRails) break;

		const picked = uniqueBy(items, mediaKey)
			.filter((item) => item.posterPath !== null && !used.has(mediaKey(item)))
			.slice(0, maxItems);

		if (picked.length < minItems) continue;

		for (const item of picked) used.add(mediaKey(item));
		rails.push({
			seedTitle: seed.title,
			seedState: seedState(seed),
			seedKey: mediaKey(seed),
			items: picked
		});
	}

	return rails;
}
