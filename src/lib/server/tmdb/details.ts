import { tmdbFetch, type TmdbRawResult } from './client';
import {
	normalizeSeasonEpisodes,
	splitSeasons,
	type TmdbSeasonDetailRaw,
	type TmdbSeasonRaw
} from './seasons';
import type { MediaDetails, MediaType, WatchOptions, WatchProvider } from '$lib/types';

/** Everything known about one title: credits, videos and where to watch it. */

/** Extra fields returned by the single-title details endpoint. */
interface TmdbGenre {
	name: string;
}
interface TmdbCastRaw {
	id: number;
	name: string;
	character?: string;
	profile_path?: string | null;
}
interface TmdbVideoRaw {
	site: string;
	type: string;
	key: string;
}

interface TmdbProviderRaw {
	provider_id: number;
	provider_name: string;
	logo_path?: string | null;
	display_priority?: number;
}
interface TmdbProviderCountryRaw {
	link?: string;
	flatrate?: TmdbProviderRaw[];
	free?: TmdbProviderRaw[];
	ads?: TmdbProviderRaw[];
	rent?: TmdbProviderRaw[];
	buy?: TmdbProviderRaw[];
}

interface TmdbDetailsRaw extends TmdbRawResult {
	vote_count?: number;
	genres?: TmdbGenre[];
	runtime?: number;
	episode_run_time?: number[];
	tagline?: string;
	number_of_seasons?: number;
	seasons?: TmdbSeasonRaw[];
	status?: string;
	backdrop_path?: string | null;
	credits?: { cast?: TmdbCastRaw[] };
	videos?: { results?: TmdbVideoRaw[] };
	'watch/providers'?: { results?: Record<string, TmdbProviderCountryRaw> };
	// Populated by `append_to_response=season/N`, keyed by that same string.
	[appendedSeason: `season/${number}`]: TmdbSeasonDetailRaw | undefined;
}

/**
 * Normalize TMDB's per-country watch providers.
 *
 * "Free with ads" is folded into `free` because the distinction between TMDB's
 * `free` and `ads` buckets is not one anybody is making when they ask where to
 * watch something. Providers are ordered by TMDB's `display_priority`, which
 * reflects how prominent the service is in that country.
 */
function normalizeWatchOptions(
	raw: Record<string, TmdbProviderCountryRaw> | undefined,
	country: string
): WatchOptions | null {
	const entry = raw?.[country];
	if (!entry) return null;

	const map = (providers: TmdbProviderRaw[] | undefined): WatchProvider[] =>
		[...(providers ?? [])]
			.sort((a, b) => (a.display_priority ?? 99) - (b.display_priority ?? 99))
			.map((provider) => ({
				id: provider.provider_id,
				name: provider.provider_name,
				logoPath: provider.logo_path ?? null
			}));

	const options: WatchOptions = {
		country,
		stream: map(entry.flatrate),
		free: [...map(entry.free), ...map(entry.ads)],
		rent: map(entry.rent),
		buy: map(entry.buy),
		link: entry.link ?? null
	};

	// A country can be listed with a link but no actual offers; that is not an
	// answer worth rendering a section for.
	const hasAny =
		options.stream.length + options.free.length + options.rent.length + options.buy.length > 0;
	return hasAny ? options : null;
}

/**
 * Fetch rich details for a single movie/TV title, including credits (cast) and
 * videos (trailer) in one request via `append_to_response`.
 */
export async function getDetails(
	mediaType: MediaType,
	id: number,
	country = 'US',
	season: number | null = null
): Promise<MediaDetails> {
	/**
	 * The requested season's episodes ride along on the same request via
	 * `append_to_response`, so showing where you are in a series costs nothing
	 * beyond the details call the sheet already makes.
	 */
	const wantsSeason = mediaType === 'tv' && Number.isInteger(season) && (season as number) >= 1;
	const appended = ['credits', 'videos', 'watch/providers'];
	if (wantsSeason) appended.push(`season/${season}`);

	const raw = await tmdbFetch<TmdbDetailsRaw>(`/${mediaType}/${id}`, {
		language: 'en-US',
		append_to_response: appended.join(',')
	});

	const seasons = mediaType === 'tv' ? splitSeasons(raw.seasons) : null;
	const videos = raw.videos?.results ?? [];
	const trailer =
		videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer') ??
		videos.find((v) => v.site === 'YouTube');

	return {
		tmdbId: raw.id,
		mediaType,
		title: raw.title ?? raw.name ?? 'Untitled',
		overview: raw.overview ?? null,
		tagline: raw.tagline?.trim() || null,
		genres: (raw.genres ?? []).map((genre) => genre.name),
		releaseDate: raw.release_date ?? raw.first_air_date ?? null,
		runtimeMinutes: raw.runtime ?? raw.episode_run_time?.[0] ?? null,
		// `number_of_seasons` is the fallback only when the season list is missing;
		// the list is the authority because it is the one that carries air dates.
		seasons: seasons?.totalSeasons ?? raw.number_of_seasons ?? null,
		airedSeasons: seasons?.airedSeasons ?? null,
		upcomingSeason: seasons?.upcomingSeason ?? null,
		episodeCounts: seasons?.episodeCounts ?? {},
		season: wantsSeason
			? normalizeSeasonEpisodes(raw[`season/${season as number}`], season as number)
			: null,
		productionStatus: raw.status?.trim() || null,
		voteAverage: raw.vote_average ?? null,
		voteCount: raw.vote_count ?? 0,
		backdropPath: raw.backdrop_path ?? null,
		posterPath: raw.poster_path ?? null,
		cast: (raw.credits?.cast ?? []).slice(0, 12).map((member) => ({
			id: member.id,
			name: member.name,
			character: member.character ?? '',
			profilePath: member.profile_path ?? null
		})),
		trailerKey: trailer?.key ?? null,
		watch: normalizeWatchOptions(raw['watch/providers']?.results, country)
	};
}

/**
 * Titles TMDB considers close to one already on the list.
 *
 * This is the same "what should I watch" question trending answers, asked of a
 * far better source: the list itself. Trending is identical for every visitor,
 * so it is the one part of Discover that can never get more relevant the longer
 * somebody uses the app.
 *
 * The endpoint is per-title and one page deep — twenty suggestions is already
 * more than a rail shows, and which titles are worth asking about is a decision
 * that belongs to `domain/recommendations`, not here.
 */
