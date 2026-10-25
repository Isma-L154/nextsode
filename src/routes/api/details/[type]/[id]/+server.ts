import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { getDetails } from '#lib/server/tmdb/index.js';
import { enforceRateLimit } from '#lib/server/rate-limit.js';
import { mediaType, parseFields, positiveInt } from '#lib/server/validation.js';
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

	const path = parseFields(pathSchema, Object.entries(params));
	if (!path) error(400, 'Invalid media type or id.');
	const { type, id: tmdbId } = path;

	/**
	 * Country travels in the query string, not in a header.
	 *
	 * The response is publicly cached, and the cache key is the URL — so reading
	 * the visitor's country from `CF-IPCountry` here would let one country's
	 * streaming offers be served to every later visitor who hit the same edge.
	 * As a query parameter it is part of the key, and each country caches apart.
	 */
	const query = parseFields(querySchema, url.searchParams);
	if (!query) error(400, 'Invalid country or season.');
	const { country, season = null } = query;

	try {
		const details = await getDetails(type, tmdbId, country, season);
		return Response.json(details, { headers: { 'cache-control': CACHE_CONTROL } });
	} catch (err) {
		console.error('TMDB details failed:', err);
		error(502, 'Failed to load title details. Please try again.');
	}
};

const pathSchema = v.strictObject({ type: mediaType, id: positiveInt });

const querySchema = v.strictObject({
	/** Two capital letters — this becomes part of a public cache key. */
	country: v.pipe(v.string(), v.regex(/^[A-Z]{2}$/)),
	/**
	 * Which season's episodes to bring along, if any. Also part of the cache key,
	 * so each season caches separately rather than the first one requested
	 * standing in for the rest.
	 */
	season: v.optional(positiveInt)
});
