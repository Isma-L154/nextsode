import type { MediaType } from '../types';

/**
 * Season-level progress for TV shows, kept pure so it can be unit tested and
 * shared by the card, the detail modal and the server actions without any of
 * them re-deriving the rules.
 *
 * "Watched / not watched" is the whole truth for a film, but for a six-season
 * show it collapses "halfway through season 3" into a state that is simply
 * wrong. This module counts seasons; `domain/episodes` refines the position
 * inside the one in progress, and defers to the count kept here for everything
 * coarser — caught-up, auto-deletion, the upcoming view.
 *
 * The ceiling is the number of seasons that have *aired*, never the number that
 * exist. TMDB counts announced seasons, so measuring against the total let you
 * tick off a season that had not been broadcast yet.
 */

export type ProgressState =
	/** Nothing watched. */
	| 'notStarted'
	/** Part-way through the aired seasons. */
	| 'inProgress'
	/** Every aired season seen, but the show has more coming. */
	| 'caughtUp'
	/** Every season seen and none announced — finished for good. */
	| 'complete';

/**
 * Sanity bound for a season count. TMDB's longest-running entries are an order
 * of magnitude below this; the limit exists to reject absurd stored values.
 */
export const MAX_SEASONS = 200;

/** The fields progress reasoning needs — structurally a subset of a DB row. */
export interface TrackableEntry {
	mediaType: MediaType;
	watched: boolean;
	seasonsSeen: number;
	/** Every season TMDB lists, aired or not. */
	totalSeasons: number | null;
	/** Seasons that have premiered. Null means "not resolved yet". */
	airedSeasons: number | null;
}

export interface SeasonProgress {
	/** False for movies, and for shows whose aired-season count we don't know. */
	trackable: boolean;
	seasonsSeen: number;
	/** The ceiling: how many seasons can actually be watched today. */
	airedSeasons: number;
	/** Including announced seasons, for context like "3 of 4". */
	totalSeasons: number;
	/** Completion against *aired* seasons as 0–100, for the progress bar. */
	percent: number;
	state: ProgressState;
	/** Human-readable summary, e.g. "Season 3 of 5". */
	label: string;
}

/**
 * How many seasons an entry can have watched, given what has aired.
 *
 * Falls back to the total only when the aired count has not been resolved yet
 * (an entry saved before air dates were tracked). That is the pre-existing
 * behaviour, and the read-path backfill replaces it on the next visit.
 */
export function watchableSeasons(entry: TrackableEntry): number | null {
	return entry.airedSeasons ?? entry.totalSeasons;
}

/**
 * Season tracking only earns its extra UI on multi-season shows. A stepper that
 * goes from 0 to 1 is pure friction, so single-season shows keep the plain
 * watched toggle — and so does a show with one aired season and a second merely
 * announced, which is the case that used to render a misleading "0 of 2".
 */
export function isTrackable(entry: TrackableEntry): boolean {
	const watchable = watchableSeasons(entry);
	return entry.mediaType === 'tv' && watchable !== null && watchable > 1;
}

export function getSeasonProgress(entry: TrackableEntry): SeasonProgress {
	if (!isTrackable(entry)) {
		return {
			trackable: false,
			seasonsSeen: 0,
			airedSeasons: 0,
			totalSeasons: entry.totalSeasons ?? 0,
			percent: entry.watched ? 100 : 0,
			state: entry.watched ? 'complete' : 'notStarted',
			label: ''
		};
	}

	const airedSeasons = watchableSeasons(entry) as number;
	const totalSeasons = Math.max(entry.totalSeasons ?? airedSeasons, airedSeasons);
	const seasonsSeen = clampSeasons(entry.seasonsSeen, airedSeasons);
	const moreComing = totalSeasons > airedSeasons;

	const state: ProgressState =
		seasonsSeen === 0
			? 'notStarted'
			: seasonsSeen < airedSeasons
				? 'inProgress'
				: moreComing
					? 'caughtUp'
					: 'complete';

	return {
		trackable: true,
		seasonsSeen,
		airedSeasons,
		totalSeasons,
		percent: Math.round((seasonsSeen / airedSeasons) * 100),
		state,
		label: describe(state, seasonsSeen, airedSeasons)
	};
}

function describe(state: ProgressState, seasonsSeen: number, airedSeasons: number): string {
	if (state === 'notStarted') return 'Not started';
	if (state === 'caughtUp') return 'Caught up';
	if (state === 'complete') return `All ${airedSeasons} seasons`;
	return `Season ${seasonsSeen} of ${airedSeasons}`;
}

/**
 * The invariant tying progress to status: finishing the last *aired* season
 * marks the show as watched, and stepping back from it un-marks it.
 *
 * Measuring against aired seasons is what makes the list self-maintaining. A
 * show you are caught up on counts as watched and drops out of "To watch"; when
 * its next season premieres the backfill raises the aired count, this returns
 * false again, and the show reappears on its own.
 *
 * Enforced on the server for every write, never only in the UI, so a stale tab
 * or a replayed form post cannot leave the two disagreeing.
 */
export function deriveWatched(seasonsSeen: number, airedSeasons: number | null): boolean {
	return airedSeasons !== null && airedSeasons > 0 && seasonsSeen >= airedSeasons;
}

/** Constrain a season target to `0..airedSeasons`, rejecting junk input. */
export function clampSeasons(value: number, airedSeasons: number | null): number {
	if (!Number.isFinite(value)) return 0;
	const upperBound = Math.min(airedSeasons ?? 0, MAX_SEASONS);
	return Math.max(0, Math.min(Math.trunc(value), upperBound));
}

/**
 * Validate a season count coming from TMDB before it is stored.
 * Anything out of range is treated as "unknown" rather than persisted.
 */
export function normalizeTotalSeasons(value: number | null | undefined): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	const total = Math.trunc(value);
	return total >= 1 && total <= MAX_SEASONS ? total : null;
}

/**
 * Same bounds as `normalizeTotalSeasons`, but zero is meaningful: a show can
 * legitimately have no aired seasons yet (announced, nothing broadcast).
 */
export function normalizeAiredSeasons(value: number | null | undefined): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	const aired = Math.trunc(value);
	return aired >= 0 && aired <= MAX_SEASONS ? aired : null;
}
