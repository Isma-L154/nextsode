import { env } from '$env/dynamic/private';
import type { MediaResult, MediaType } from '$lib/types';

/**
 * The one way this codebase talks to TMDB, and the two shapes every endpoint
 * answers in.
 *
 * Server-only: this module lives under `$lib/server`, so SvelteKit guarantees
 * it can never be bundled into client code — the access token stays on the
 * server at all times.
 */

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

/** Raw TMDB item. Movies expose `title`/`release_date`; TV uses `name`/`first_air_date`. */
export interface TmdbRawResult {
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

export interface TmdbPaginatedResponse {
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
export async function tmdbFetch<T>(
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
export function normalize(raw: TmdbRawResult, mediaType: MediaType): MediaResult {
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
