import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { getTrending } from '#lib/server/tmdb/index.js';
import { enforceRateLimit } from '#lib/server/rate-limit.js';
import { parseFields, positiveInt } from '#lib/server/validation.js';
import type { RequestHandler } from './$types';

/**
 * Trending is identical for every visitor and only moves once a week, so it is
 * safe to cache at the edge. That keeps the shared TMDB token from being
 * rate-limited by anyone hammering "Load more", and makes paging back through
 * pages the visitor has already seen instant.
 *
 * The window is shorter than the details cache: this list is meant to feel
 * current, and a stale-while-revalidate day covers the gap without ever showing
 * an empty grid.
 */
const CACHE_CONTROL = 'public, max-age=900, s-maxage=3600, stale-while-revalidate=86400';

/**
 * GET /api/trending?page=<n>
 *
 * Server-side proxy for one page of trending titles. The first page is already
 * server-rendered with the document; this backs the "Load more" control, so the
 * initial paint never pays for titles below the fold.
 */
export const GET: RequestHandler = async (event) => {
	await enforceRateLimit(event);
	const { url } = event;

	const query = parseFields(v.strictObject({ page: v.optional(positiveInt) }), url.searchParams);
	if (!query) error(400, 'Invalid page.');
	const { page = 1 } = query;

	try {
		// `getTrending` clamps the upper bound, so a huge page number costs one
		// request against the last real page rather than an unbounded fetch.
		return Response.json(await getTrending(page), { headers: { 'cache-control': CACHE_CONTROL } });
	} catch (err) {
		console.error('TMDB trending failed:', err);
		error(502, 'Failed to load more titles. Please try again.');
	}
};
