import { isTrackable } from './progress';
import { hasStarted } from './episodes';
import { hasUpcoming, upcomingSortKey } from './upcoming';
import type { MediaType } from '../types';

/**
 * Pure, framework-agnostic filtering and sorting for the saved list.
 * Extracted from the UI so it can be unit-tested in isolation.
 */

/** Minimal shape needed to filter/sort; structurally compatible with a DB row. */
export interface WatchlistEntry {
	title: string;
	mediaType: MediaType;
	watched: boolean;
	voteAverage: number | null;
	releaseDate: string | null;
	seasonsSeen: number;
	/** Episodes into the season after `seasonsSeen` — see `domain/episodes`. */
	episodesIntoSeason: number;
	totalSeasons: number | null;
	airedSeasons: number | null;
	/** The next season still to premiere; null when there is none. */
	nextSeasonNumber: number | null;
	nextSeasonAirDate: string | null;
}

/** Current view options coming from the UI controls. */
export interface WatchlistView {
	/** 'all' | 'toWatch' | 'inProgress' | 'upcoming' | 'watched' */
	status: string;
	/** 'all' | 'movie' | 'tv' */
	type: string;
	/** 'recent' | 'rating' | 'title' | 'soonest' */
	sort: string;
	/** Free-text title filter. */
	query: string;
}

/**
 * Apply the status/type/search filters and then the chosen sort.
 *
 * The `recent` sort intentionally preserves the input order (the DB already
 * returns rows newest-first), so callers don't need an explicit timestamp here.
 * `now` is injectable purely so the release-date logic stays deterministic
 * under test.
 */
export function applyWatchlistView<T extends WatchlistEntry>(
	items: readonly T[],
	view: WatchlistView,
	now: Date = new Date()
): T[] {
	const query = view.query.trim().toLowerCase();

	const filtered = items.filter((item) => {
		const matchesStatus =
			view.status === 'all' ||
			(view.status === 'toWatch' && !item.watched) ||
			(view.status === 'watched' && item.watched) ||
			(view.status === 'upcoming' && hasUpcoming(item, now)) ||
			(view.status === 'inProgress' && isInProgress(item));
		return matchesStatus && matchesRest(item);
	});

	function matchesRest(item: WatchlistEntry): boolean {
		const matchesType = view.type === 'all' || item.mediaType === view.type;
		const matchesQuery = query === '' || item.title.toLowerCase().includes(query);
		return matchesType && matchesQuery;
	}

	const sorted = [...filtered];
	if (view.sort === 'rating') {
		// Highest rated first; missing ratings sink to the bottom.
		sorted.sort((a, b) => (b.voteAverage ?? -1) - (a.voteAverage ?? -1));
	} else if (view.sort === 'title') {
		sorted.sort((a, b) => a.title.localeCompare(b.title));
	} else if (view.sort === 'soonest') {
		// Nearest thing first, whether that is a premiere or a new season;
		// already-available and undated titles go last.
		sorted.sort((a, b) => upcomingSortKey(a, now) - upcomingSortKey(b, now));
	}
	return sorted;
}

/**
 * A show that has been started but not finished — "what was I in the middle of?"
 *
 * "Started" is the episode bookmark as well as the season counter, or a show you
 * are three episodes into would answer the question correctly on its own card
 * and still be missing from the rail that asks it.
 */
export function isInProgress(item: WatchlistEntry): boolean {
	return isTrackable(item) && hasStarted(item) && !item.watched;
}

/**
 * Count how many entries are in each status bucket (for the tab badges).
 *
 * Every count is over the same list the corresponding tab will show — a badge
 * that counts rows the tab then filters out is just a lie with a number on it.
 */
export function countByStatus(
	items: readonly WatchlistEntry[],
	now: Date = new Date()
): {
	all: number;
	toWatch: number;
	inProgress: number;
	upcoming: number;
	watched: number;
} {
	let watched = 0;
	let inProgress = 0;
	let upcoming = 0;

	for (const item of items) {
		if (item.watched) watched++;
		if (isInProgress(item)) inProgress++;
		if (hasUpcoming(item, now)) upcoming++;
	}

	return { all: items.length, toWatch: items.length - watched, inProgress, upcoming, watched };
}
