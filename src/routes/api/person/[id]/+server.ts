import { error } from '@sveltejs/kit';
import { getPersonFilmography } from '#lib/server/tmdb/index.js';
import { enforceRateLimit } from '#lib/server/rate-limit.js';
import type { RequestHandler } from './$types';

/**
 * A career is the most static thing this app serves and is identical for every
 * visitor, so it caches hard at the edge — which is also what keeps the shared
 * TMDB token safe from anyone walking person ids in a loop.
 */
const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

/**
 * GET /api/person/<id>
 *
 * The filmography panel behind a cast member. Server-side proxy, so the TMDB
 * access token stays on the server.
 */
export const GET: RequestHandler = async (event) => {
	await enforceRateLimit(event);

	const personId = Number(event.params.id);
	if (!Number.isInteger(personId) || personId <= 0) {
		error(400, 'Invalid person id.');
	}

	try {
		const person = await getPersonFilmography(personId);
		return Response.json(person, { headers: { 'cache-control': CACHE_CONTROL } });
	} catch (err) {
		console.error('TMDB person failed:', err);
		error(502, 'Failed to load this person. Please try again.');
	}
};
