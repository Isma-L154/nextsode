import { getDetails } from '../tmdb';
import { normalizeAiredSeasons, normalizeTotalSeasons } from '#lib/domain/progress.js';
import type { MediaType } from '#lib/types.js';

/**
 * Asking TMDB about a show's seasons, and deciding what that answer means.
 *
 * The distinction this module exists to hold: a request that *failed* and a
 * request that *succeeded with nothing* are not the same event, and treating
 * them alike is what makes a backfill either give up too early or retry
 * forever.
 */

/**
 * Written to `totalSeasons` when TMDB answered but had no usable season count.
 *
 * Zero is a safe marker because a real count is always at least 1 (see
 * `normalizeTotalSeasons`), and it is inert everywhere downstream: `isTrackable`
 * needs more than one season, so the entry simply keeps the plain watched
 * toggle. Its only job is to say "already checked, don't ask again".
 */
export const NO_SEASON_DATA = 0;

/** Everything a row stores about a show's seasons. */
export interface SeasonInfo {
	totalSeasons: number | null;
	airedSeasons: number | null;
	nextSeasonNumber: number | null;
	nextSeasonAirDate: string | null;
}

/** No season data at all — nothing to track, nothing to come. */
const NO_SEASONS: SeasonInfo = {
	totalSeasons: NO_SEASON_DATA,
	airedSeasons: NO_SEASON_DATA,
	nextSeasonNumber: null,
	nextSeasonAirDate: null
};

/** Details for a show, or null when TMDB could not be reached. */
export async function safeDetails(tmdbId: number, season: number | null = null) {
	try {
		return await getDetails('tv', tmdbId, 'US', season);
	} catch (err) {
		console.error('Failed to read details for tv/%d:', tmdbId, err);
		return null;
	}
}

/**
 * How many of a show's seasons exist, how many have aired, and when the next
 * one lands.
 *
 * Returns null when the request itself failed, versus a `NO_SEASON_DATA`-filled
 * record when TMDB answered but had nothing usable — the distinction the refresh
 * relies on to choose between "try again later" and "record this and stop".
 */
export async function resolveSeasonInfo(tmdbId: number): Promise<SeasonInfo | null> {
	try {
		const details = await getDetails('tv', tmdbId);
		const totalSeasons = normalizeTotalSeasons(details.seasons);
		const airedSeasons = normalizeAiredSeasons(details.airedSeasons);
		if (totalSeasons === null || airedSeasons === null) return NO_SEASONS;

		return {
			totalSeasons,
			airedSeasons,
			nextSeasonNumber: details.upcomingSeason?.number ?? null,
			nextSeasonAirDate: details.upcomingSeason?.airDate ?? null
		};
	} catch (err) {
		console.error('Failed to read season data for tv/%d:', tmdbId, err);
		return null;
	}
}

/** Nothing known yet, which is every film and any lookup that failed. */
const UNRESOLVED: SeasonInfo = {
	totalSeasons: null,
	airedSeasons: null,
	nextSeasonNumber: null,
	nextSeasonAirDate: null
};

/**
 * Season data for a title being saved. Films have none, and a failed lookup is
 * non-fatal: the entry is stored without it and the read path repairs it.
 */
export async function seasonInfoForSave(mediaType: MediaType, tmdbId: number): Promise<SeasonInfo> {
	if (mediaType !== 'tv') return UNRESOLVED;
	return (await resolveSeasonInfo(tmdbId)) ?? UNRESOLVED;
}
