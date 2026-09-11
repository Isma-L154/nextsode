import type { Episode, SeasonEpisodes, UpcomingSeason } from '$lib/types';

/**
 * Reading TMDB's season and episode data, and deciding what has actually aired.
 *
 * The distinction this module holds is the one the rest of the app depends on:
 * TMDB counts announced seasons alongside broadcast ones, and progress can only
 * ever be measured against the seasons that exist.
 */

export interface TmdbSeasonRaw {
	season_number: number;
	air_date?: string | null;
	episode_count?: number;
}

interface TmdbEpisodeRaw {
	episode_number: number;
	name?: string;
	air_date?: string | null;
	runtime?: number | null;
}
export interface TmdbSeasonDetailRaw {
	season_number?: number;
	episodes?: TmdbEpisodeRaw[];
}

/**
 * Whether a `YYYY-MM-DD` date has arrived, compared as calendar days in UTC.
 *
 * Shared by seasons and episodes so both answer "is this out yet?" the same way
 * — a premiere on the 12th is out on the 12th regardless of the viewer's zone.
 */
function hasAired(date: string | null | undefined, now: Date): boolean {
	if (!date) return false;
	const parsed = Date.parse(`${date}T00:00:00Z`);
	const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
	return Number.isFinite(parsed) && parsed <= todayUtc;
}

/**
 * Normalize one season's episode list.
 *
 * The overview and still image of every episode are dropped: they multiply the
 * payload several times over for something no view renders, and this response is
 * cached at the edge for every visitor.
 */
export function normalizeSeasonEpisodes(
	raw: TmdbSeasonDetailRaw | undefined,
	seasonNumber: number,
	now: Date = new Date()
): SeasonEpisodes | null {
	const list = raw?.episodes;
	if (!list || list.length === 0) return null;

	const episodes: Episode[] = list
		.filter((episode) => Number.isInteger(episode.episode_number) && episode.episode_number >= 1)
		.sort((a, b) => a.episode_number - b.episode_number)
		.map((episode) => ({
			number: episode.episode_number,
			name: episode.name?.trim() || `Episode ${episode.episode_number}`,
			airDate: episode.air_date ?? null,
			runtimeMinutes: episode.runtime ?? null,
			aired: hasAired(episode.air_date, now)
		}));

	if (episodes.length === 0) return null;

	return {
		seasonNumber,
		episodes,
		airedCount: episodes.filter((episode) => episode.aired).length
	};
}

/** What the season list tells us once unaired seasons are separated out. */
export interface SeasonBreakdown {
	/** Every season TMDB lists, aired or not. */
	totalSeasons: number | null;
	/** Seasons that have actually premiered — the ceiling for progress. */
	airedSeasons: number | null;
	upcomingSeason: UpcomingSeason | null;
	/** Episodes per numbered season, so rollover needs no extra request. */
	episodeCounts: Record<number, number>;
}

/**
 * Split a show's seasons into "already premiered" and "still to come".
 *
 * TMDB's `number_of_seasons` counts announced seasons, which is what makes a
 * show with three aired seasons and a fourth dated for next year look fully
 * watchable today. Season 0 ("Specials") is excluded throughout: it is not part
 * of the numbered run and counting it would shift every season by one.
 *
 * A season with no `air_date` is treated as *not* aired. TMDB leaves the date
 * empty for seasons that are announced but unscheduled, and guessing "aired"
 * there would recreate the exact bug this exists to prevent.
 */
export function splitSeasons(
	seasons: TmdbSeasonRaw[] | undefined,
	now: Date = new Date()
): SeasonBreakdown {
	const numbered = (seasons ?? [])
		.filter((season) => Number.isInteger(season.season_number) && season.season_number >= 1)
		.sort((a, b) => a.season_number - b.season_number);

	if (numbered.length === 0)
		return { totalSeasons: null, airedSeasons: null, upcomingSeason: null, episodeCounts: {} };

	const premiered = (season: TmdbSeasonRaw) => hasAired(season.air_date, now);
	const aired = numbered.filter(premiered);
	const next = numbered.find((season) => !premiered(season));

	const episodeCounts: Record<number, number> = {};
	for (const season of numbered) {
		if (typeof season.episode_count === 'number' && season.episode_count > 0) {
			episodeCounts[season.season_number] = season.episode_count;
		}
	}

	return {
		totalSeasons: numbered.length,
		airedSeasons: aired.length,
		upcomingSeason: next ? { number: next.season_number, airDate: next.air_date ?? null } : null,
		episodeCounts
	};
}

/**
 * Normalize TMDB's per-country watch providers.
 *
 * "Free with ads" is folded into `free` because the distinction between TMDB's
 * `free` and `ads` buckets is not one anybody is making when they ask where to
 * watch something. Providers are ordered by TMDB's `display_priority`, which
 * reflects how prominent the service is in that country.
 */
