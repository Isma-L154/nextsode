import { env } from '$env/dynamic/private';
import {
	PEOPLE_RESULTS_SIZE,
	PERSON_CREDITS_SIZE,
	rankCredits,
	rankPeople,
	type CreditCandidate,
	type PersonCandidate
} from '$lib/domain/filmography';
import type {
	Episode,
	MediaDetails,
	MediaResult,
	MediaType,
	PersonCredit,
	PersonFilmography,
	PersonResult,
	SeasonEpisodes,
	UpcomingSeason,
	WatchOptions,
	WatchProvider
} from '$lib/types';

/**
 * Server-only TMDB client. This module lives under `$lib/server`, so SvelteKit
 * guarantees it can never be bundled into client code — the access token stays
 * on the server at all times.
 */

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

/** Raw TMDB item. Movies expose `title`/`release_date`; TV uses `name`/`first_air_date`. */
interface TmdbRawResult {
	id: number;
	media_type?: string;
	title?: string;
	name?: string;
	poster_path?: string | null;
	release_date?: string;
	first_air_date?: string;
	overview?: string;
	vote_average?: number;
}

interface TmdbPaginatedResponse {
	results: TmdbRawResult[];
	page?: number;
	total_pages?: number;
}

/**
 * Perform an authenticated GET against the TMDB API and parse the JSON body.
 *
 * `cacheSeconds` hands the response to Cloudflare's edge cache. It is keyed by
 * URL and holds nothing user-specific — every visitor asking about the same
 * title gets the same answer — so the saving is shared rather than per-session.
 * `cacheEverything` is required because the request carries an `Authorization`
 * header, which the edge otherwise treats as a reason never to cache; the header
 * is our own server token, not the visitor's, so it identifies nobody.
 *
 * The option is Cloudflare-only and simply ignored elsewhere, which is what
 * keeps local development and the tests on live data.
 */
async function tmdbFetch<T>(
	path: string,
	params: Record<string, string> = {},
	cacheSeconds = 0
): Promise<T> {
	const token = env.TMDB_ACCESS_TOKEN;
	if (!token) throw new Error('TMDB_ACCESS_TOKEN is not set');

	const url = new URL(`${TMDB_BASE_URL}${path}`);
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			accept: 'application/json'
		},
		...(cacheSeconds > 0 && { cf: { cacheTtl: cacheSeconds, cacheEverything: true } })
	});

	if (!response.ok) {
		throw new Error(`TMDB request failed with status ${response.status}`);
	}

	return response.json() as Promise<T>;
}

/** Convert a raw TMDB item into our normalized, media-type-agnostic shape. */
function normalize(raw: TmdbRawResult, mediaType: MediaType): MediaResult {
	return {
		tmdbId: raw.id,
		mediaType,
		title: raw.title ?? raw.name ?? 'Untitled',
		posterPath: raw.poster_path ?? null,
		releaseDate: raw.release_date ?? raw.first_air_date ?? null,
		overview: raw.overview ?? null,
		voteAverage: raw.vote_average ?? null
	};
}

/** Person entries in a multi-search, which carry their best-known titles inline. */
interface TmdbPersonSearchRaw {
	id: number;
	media_type?: string;
	name?: string;
	profile_path?: string | null;
	known_for_department?: string;
	popularity?: number;
	known_for?: TmdbRawResult[];
}

/** How many titles a person's search entry names to tell them apart by. */
const KNOWN_FOR_TITLES = 2;

/** Both halves of what a search can match. */
export interface SearchResults {
	titles: MediaResult[];
	people: PersonResult[];
}

/**
 * Search movies, TV shows and people in a single request via TMDB multi-search.
 *
 * People used to be discarded here, which made the app searchable only by title
 * — the one thing you cannot do is look up the actor whose name you remember
 * when the film's has gone. They come back from the same response as the titles,
 * so answering both halves of the question costs no extra request.
 *
 * `known_for` rides along on each person entry, which is what lets the strip say
 * *which* Chris Evans this is without a second lookup per face.
 */
export async function searchMulti(query: string): Promise<SearchResults> {
	const data = await tmdbFetch<TmdbPaginatedResponse & { results: TmdbPersonSearchRaw[] }>(
		'/search/multi',
		{
			query,
			include_adult: 'false',
			language: 'en-US',
			page: '1'
		}
	);

	const raw = data.results as (TmdbRawResult & TmdbPersonSearchRaw)[];

	const titles = raw
		.filter(
			(item): item is TmdbRawResult & { media_type: MediaType } =>
				item.media_type === 'movie' || item.media_type === 'tv'
		)
		.map((item) => normalize(item, item.media_type));

	const people = raw
		.filter((item) => item.media_type === 'person')
		.map((item): PersonResult & PersonCandidate => ({
			id: item.id,
			name: item.name?.trim() || 'Unknown',
			profilePath: item.profile_path ?? null,
			knownFor: item.known_for_department?.trim() || null,
			knownForTitles: (item.known_for ?? [])
				.map((credit) => credit.title ?? credit.name ?? '')
				.filter(Boolean)
				.slice(0, KNOWN_FOR_TITLES),
			popularity: item.popularity ?? 0
		}));

	return {
		titles,
		// The ranking score is dropped rather than sent on: the order is the
		// answer, and the number behind it is not the browser's business.
		people: rankPeople(people, PEOPLE_RESULTS_SIZE).map(
			({ id, name, profilePath, knownFor, knownForTitles }) => ({
				id,
				name,
				profilePath,
				knownFor,
				knownForTitles
			})
		)
	};
}

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
interface TmdbSeasonRaw {
	season_number: number;
	air_date?: string | null;
	episode_count?: number;
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
interface TmdbEpisodeRaw {
	episode_number: number;
	name?: string;
	air_date?: string | null;
	runtime?: number | null;
}
interface TmdbSeasonDetailRaw {
	season_number?: number;
	episodes?: TmdbEpisodeRaw[];
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
/**
 * A day at the edge.
 *
 * What a title is close to does not move hour to hour, and the rows are rebuilt
 * on every visit to Discover — so without this, opening the page twice costs two
 * identical sets of lookups. The rows still turn over daily; that comes from
 * which titles get asked about, not from asking the same one again.
 */
const RECOMMENDATION_CACHE_SECONDS = 86_400;

export async function getRecommendations(mediaType: MediaType, id: number): Promise<MediaResult[]> {
	const data = await tmdbFetch<TmdbPaginatedResponse>(
		`/${mediaType}/${id}/recommendations`,
		{ language: 'en-US', page: '1' },
		RECOMMENDATION_CACHE_SECONDS
	);

	// Recommendations for a film are overwhelmingly films, but TMDB does mix in
	// the odd show, so the per-result type wins and the seed's is only a fallback.
	return data.results.map((raw) =>
		normalize(
			raw,
			raw.media_type === 'movie' || raw.media_type === 'tv' ? raw.media_type : mediaType
		)
	);
}

/** One page of trending titles, plus whether another page exists. */
export interface TrendingPage {
	results: MediaResult[];
	page: number;
	hasMore: boolean;
}

/**
 * TMDB caps trending at 500 pages, and we stop well short of it: nobody browses
 * two thousand titles, and the tail of the trending list is noise. This is a
 * guard against an unbounded `?page=` in the URL, not a UX target.
 */
const MAX_TRENDING_PAGES = 25;

/**
 * Fetch a page of this week's trending movies and TV shows. Used to populate the
 * home screen with content before the user has searched for anything.
 *
 * Pages hold 20 titles and do not overlap, so appending them is safe. `person`
 * entries are filtered out, which is why a page can return fewer than 20.
 */
export async function getTrending(page = 1): Promise<TrendingPage> {
	const safePage = Math.min(Math.max(Math.trunc(page) || 1, 1), MAX_TRENDING_PAGES);

	const data = await tmdbFetch<TmdbPaginatedResponse>('/trending/all/week', {
		language: 'en-US',
		page: String(safePage)
	});

	const results = data.results
		.filter(
			(raw): raw is TmdbRawResult & { media_type: MediaType } =>
				raw.media_type === 'movie' || raw.media_type === 'tv'
		)
		.map((raw) => normalize(raw, raw.media_type));

	const lastPage = Math.min(data.total_pages ?? safePage, MAX_TRENDING_PAGES);

	return { results, page: safePage, hasMore: safePage < lastPage };
}

/** A person's own record, and their whole career in one response. */
interface TmdbPersonCreditRaw extends TmdbRawResult {
	character?: string;
	popularity?: number;
	vote_count?: number;
	episode_count?: number;
}

interface TmdbPersonRaw {
	id: number;
	name?: string;
	profile_path?: string | null;
	known_for_department?: string;
	combined_credits?: { cast?: TmdbPersonCreditRaw[] };
}

/**
 * A career changes about as often as a birthday, so this caches for a day at the
 * edge like recommendations do. Keyed by person id and identical for everyone.
 */
const PERSON_CACHE_SECONDS = 86_400;

/**
 * Who somebody is, and the few titles worth recognising them from.
 *
 * `combined_credits` is appended rather than fetched separately: the panel needs
 * both halves before it can render anything, and two round trips from the worker
 * to TMDB would be paid on every face a viewer taps.
 *
 * The ranking is deliberately not done here — see `domain/filmography` for what
 * "worth recognising" means and why it is not simply the most recent five.
 */
export async function getPersonFilmography(personId: number): Promise<PersonFilmography> {
	const raw = await tmdbFetch<TmdbPersonRaw>(
		`/person/${personId}`,
		{ language: 'en-US', append_to_response: 'combined_credits' },
		PERSON_CACHE_SECONDS
	);

	const candidates = (raw.combined_credits?.cast ?? [])
		.filter(
			(credit): credit is TmdbPersonCreditRaw & { media_type: MediaType } =>
				credit.media_type === 'movie' || credit.media_type === 'tv'
		)
		.map((credit): PersonCredit & CreditCandidate => ({
			...normalize(credit, credit.media_type),
			character: credit.character?.trim() || null,
			voteCount: credit.vote_count ?? 0,
			popularity: credit.popularity ?? 0,
			episodeCount: credit.media_type === 'tv' ? (credit.episode_count ?? null) : null
		}));

	return {
		id: raw.id,
		name: raw.name?.trim() || 'Unknown',
		profilePath: raw.profile_path ?? null,
		knownFor: raw.known_for_department?.trim() || null,
		// Ranking fields are dropped here rather than carried to the client: the
		// order is the answer, and the numbers behind it are not the browser's
		// business.
		credits: rankCredits(candidates, PERSON_CREDITS_SIZE).map(
			({
				tmdbId,
				mediaType,
				title,
				posterPath,
				releaseDate,
				overview,
				voteAverage,
				character
			}) => ({
				tmdbId,
				mediaType,
				title,
				posterPath,
				releaseDate,
				overview,
				voteAverage,
				character
			})
		)
	};
}
