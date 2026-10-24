import { error, json } from '@sveltejs/kit';
import { getDetails } from '#lib/server/tmdb/index.js';
import { enforceRateLimit } from '#lib/server/rate-limit.js';
import type { RequestHandler } from './$types';

/**
 * Details change rarely and are identical for every visitor, so they are safe to
 * cache at the edge. This keeps the shared TMDB token from being rate-limited by
 * anyone looping the endpoint, and makes a re-opened modal instant.
 */
const CACHE_CONTROL = 'public, max-age=600, s-maxage=21600, stale-while-revalidate=86400';

/**
 * GET /api/details/<movie|tv>/<id>
 *
 * Server-side proxy for a single title's full details (genres, cast, trailer).
 * Keeps the TMDB access token on the server.
 */
export const GET: RequestHandler = async (event) => {
	await enforceRateLimit(event);
	const { params, url } = event;

	const { type, id } = params;
	const tmdbId = Number(id);

	if ((type !== 'movie' && type !== 'tv') || !Number.isInteger(tmdbId) || tmdbId <= 0) {
		error(400, 'Invalid media type or id.');
	}

	/**
	 * Country travels in the query string, not in a header.
	 *
	 * The response is publicly cached, and the cache key is the URL — so reading
	 * the visitor's country from `CF-IPCountry` here would let one country's
	 * streaming offers be served to every later visitor who hit the same edge.
	 * As a query parameter it is part of the key, and each country caches apart.
	 */
	const country = normalizeCountry(url.searchParams.get('country'));

	/**
	 * Which season's episodes to bring along, if any. Also part of the cache key,
	 * so each season caches separately rather than the first one requested
	 * standing in for the rest.
	 */
	const seasonParam = Number(url.searchParams.get('season'));
	const season = Number.isInteger(seasonParam) && seasonParam >= 1 ? seasonParam : null;

	try {
		const details = await getDetails(type, tmdbId, country, season);
		return json(details, { headers: { 'cache-control': CACHE_CONTROL } });
	} catch (err) {
		console.error('TMDB details failed:', err);
		error(502, 'Failed to load title details. Please try again.');
	}
};

/** Two ASCII letters or nothing — this becomes part of a public cache key. */
function normalizeCountry(value: string | null): string {
	const country = (value ?? '').toUpperCase();
	return /^[A-Z]{2}$/.test(country) ? country : 'US';
}
