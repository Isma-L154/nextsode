import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { searchMulti } from '#lib/server/tmdb/index.js';
import { enforceRateLimit } from '#lib/server/rate-limit.js';
import { parseFields } from '#lib/server/validation.js';
import type { RequestHandler } from './$types';

/**
 * Longest query we forward to TMDB.
 *
 * The endpoint is public, so the query string is attacker-controlled. Without a
 * cap, a single request could push an arbitrarily large string into an outbound
 * TMDB URL; no real search is anywhere near this long. The search box caps its
 * input at the same length, so only a hand-built request is refused.
 */
const MAX_QUERY_LENGTH = 120;

/**
 * How long a search result may be reused.
 *
 * TMDB's catalogue barely moves minute to minute, and the access token is shared
 * by every visitor — so an uncached endpoint lets anyone burn the whole app's
 * rate limit in a loop. Letting Cloudflare's edge cache absorb repeated queries
 * is both the cheapest abuse mitigation available on a free tier and a
 * straight latency win for common searches.
 */
const CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

/**
 * GET /api/search?q=<query>
 *
 * Server-side proxy to TMDB multi-search. The browser calls this endpoint
 * instead of TMDB directly, which keeps the access token off the client.
 *
 * Titles and people come back as separate lists rather than one mixed array:
 * they are different shapes, they are shown in different places, and merging
 * them would push the decision of which is which into the browser.
 */
export const GET: RequestHandler = async (event) => {
	await enforceRateLimit(event);
	const { url } = event;

	const input = parseFields(
		v.strictObject({ q: v.pipe(v.string(), v.trim(), v.maxLength(MAX_QUERY_LENGTH)) }),
		url.searchParams
	);
	if (!input) error(400, 'Invalid search.');
	const query = input.q;
	if (!query) return Response.json({ results: [], people: [] });

	try {
		const { titles, people } = await searchMulti(query);
		return Response.json(
			{ results: titles, people },
			{ headers: { 'cache-control': CACHE_CONTROL } }
		);
	} catch (err) {
		console.error('TMDB search failed:', err);
		error(502, 'Failed to reach the movie database. Please try again.');
	}
};
