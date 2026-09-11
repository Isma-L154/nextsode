import { normalize, tmdbFetch, type TmdbPaginatedResponse } from './client';
import type { MediaResult, MediaType } from '$lib/types';

/** "More like this", for one title. */

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
