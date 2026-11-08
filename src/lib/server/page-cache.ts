import type { RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { version } from '$app/env';
import { SESSION_COOKIE } from '#lib/server/auth.js';
import { resolveCountry } from '#lib/server/country.js';

/** The slice of the Cache API this needs, so tests can supply a fake. */
export interface PageStore {
	match(key: Request): Promise<Response | undefined>;
	put(key: Request, response: Response): Promise<void>;
}

// Six hours: ratings, streaming offers and the next episode change within a
// day, not within minutes.
const CACHE_TTL_SECONDS = 6 * 60 * 60;

/**
 * SvelteKit gives a __data.json request the page's own URL, so it would share
 * the HTML's key. A session cookie bypasses the cache in both directions:
 * a signed-in visitor's page shows their own saved state.
 */
function mayUseCache(event: RequestEvent): boolean {
	return (
		event.request.method === 'GET' &&
		event.url.pathname.startsWith('/title/') &&
		event.url.search === '' &&
		!event.isDataRequest &&
		!event.isSubRequest &&
		event.cookies.get(SESSION_COOKIE) === undefined
	);
}

// Check locals.user after resolve: whatever decided who the visitor is, the
// invariant that matters is that a personalized page is never stored.
function mayStoreResponse(event: RequestEvent, response: Response): boolean {
	return (
		response.status === 200 && !response.headers.has('set-cookie') && event.locals.user === null
	);
}

// The "where to watch" band depends on the country. The build version retires
// HTML that names asset files the next deploy no longer serves.
function cacheKey(event: RequestEvent): Request {
	const { origin, pathname } = event.url;
	const country = resolveCountry(event.request);
	return new Request(`${origin}${pathname}?country=${country}&build=${version}`);
}

/** Reuse title pages for crawlers and signed-out visitors asking for the same titles. */
export function cacheSignedOutPages(store: () => PageStore | undefined): Handle {
	return async ({ event, resolve }) => {
		if (!mayUseCache(event)) return resolve(event);
		const pageStore = store();
		if (!pageStore) return resolve(event);

		const key = cacheKey(event);
		try {
			const cached = await pageStore.match(key);
			if (cached) {
				// Keep the browser from showing a copy from before sign-in afterwards.
				// The page's rate limiter is skipped on purpose: a hit spends neither
				// TMDB quota nor render CPU.
				const response = new Response(cached.body, cached);
				response.headers.set('cache-control', 'private, no-store');
				return response;
			}
		} catch (err) {
			console.error('Page cache lookup failed:', err);
		}

		const response = await resolve(event);
		if (mayStoreResponse(event, response)) {
			try {
				const cached = new Response(response.clone().body, response);
				cached.headers.set('cache-control', `public, s-maxage=${CACHE_TTL_SECONDS}`);
				// Using waitUntil would pull in cloudflare:workers, which Node tests
				// cannot load. Awaiting the write adds wall time only on a miss, not CPU.
				await pageStore.put(key, cached);
			} catch (err) {
				console.error('Page cache write failed:', err);
			}
		}
		return response;
	};
}
