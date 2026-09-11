import { normalize, tmdbFetch, type TmdbPaginatedResponse, type TmdbRawResult } from './client';
import { PEOPLE_RESULTS_SIZE, rankPeople, type PersonCandidate } from '$lib/domain/filmography';
import type { MediaResult, MediaType, PersonResult } from '$lib/types';

/** Searching titles and people in one request, and ranking what comes back. */

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
