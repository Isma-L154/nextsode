import { normalize, tmdbFetch, type TmdbPaginatedResponse, type TmdbRawResult } from './client';
import type { MediaResult, MediaType } from '$lib/types';

/** This week's trending titles, paged. */

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
