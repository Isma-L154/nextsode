import { sequence, type Handle } from '@sveltejs/kit/hooks';

import {
	SESSION_COOKIE,
	deleteSessionCookie,
	setSessionCookie,
	validateSession
} from '$lib/server/auth';

/**
 * The host this site answers on. Everything else is history or a preview.
 */
const CANONICAL_HOST = 'nextsode.cloudils.com';

/**
 * The address this site used to live at, before it had a domain of its own.
 */
const RETIRED_HOST = 'nextsode.ilsproj.workers.dev';

/**
 * Send the old address to the new one.
 *
 * Two hostnames written out by hand, which is deliberate and not the same
 * mistake `robots.txt` used to make. That file named a host it should have
 * derived from the request; this is a fixed mapping between one specific old
 * address and one specific new one — a fact about a migration, not a value that
 * can silently go stale. It can be deleted outright once nothing arrives here.
 *
 * Matched on the exact hostname rather than on `.workers.dev`, because preview
 * deployments are served from versioned subdomains of it. A broader test would
 * bounce every preview to production and quietly make previews useless.
 *
 * `GET` and `HEAD` get a 301: that is the code search engines act on, and the
 * point is for the old URL's standing to move rather than be thrown away.
 * Anything else gets a 308, which preserves the method — someone with the old
 * page still open and a form to submit would otherwise have their POST turned
 * into a GET and their save silently dropped.
 */
export const redirectRetiredHost: Handle = async ({ event, resolve }) => {
	if (event.url.hostname !== RETIRED_HOST) return resolve(event);

	const target = new URL(event.url);
	target.hostname = CANONICAL_HOST;
	target.protocol = 'https:';
	target.port = '';

	const safeMethod = event.request.method === 'GET' || event.request.method === 'HEAD';

	return new Response(null, {
		status: safeMethod ? 301 : 308,
		headers: { location: target.toString() }
	});
};

/**
 * Resolve the session cookie once per request and expose the result on
 * `event.locals`, so every load function and action can trust `locals.user`
 * without repeating the lookup.
 */
const authenticate: Handle = async ({ event, resolve }) => {
	event.locals.user = null;

	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		try {
			const result = await validateSession(token);
			if (result) {
				event.locals.user = result.user;
				// Re-issue the cookie when the session was extended, so the browser's
				// copy expires at the same time as the database row.
				if (result.renewed) setSessionCookie(event.cookies, token, result.expiresAt);
			} else {
				deleteSessionCookie(event.cookies);
			}
		} catch (err) {
			// A database hiccup must not take the whole site down — the visitor is
			// simply treated as signed out for this request.
			console.error('Session validation failed:', err);
		}
	}

	return resolve(event);
};

/**
 * Baseline response headers.
 *
 * `frame-ancestors` is the one that matters most here: without it, a hostile
 * page could load the app in an invisible iframe over its own UI and harvest a
 * signed-in visitor's clicks onto the remove and progress buttons. The rest
 * close off MIME sniffing, referrer leakage and unused device APIs.
 */
const securityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	// The full policy is generated per response by SvelteKit, which knows the
	// hashes of its own inline scripts — see `csp` in vite.config.ts. This one
	// remains for the responses that never pass through it, such as the API
	// proxies, where a bare frame-ancestors is still worth having.
	if (!response.headers.has('content-security-policy')) {
		response.headers.set('content-security-policy', "frame-ancestors 'none'");
	}
	response.headers.set('x-frame-options', 'DENY');
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
	response.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');

	/**
	 * Refuse to be spoken to over plain HTTP again.
	 *
	 * Deliberately without `includeSubDomains` and without `preload`. This host
	 * sits under a shared public suffix, so those would reach hostnames belonging
	 * to other people's projects — a commitment that is not ours to make.
	 */
	response.headers.set('strict-transport-security', 'max-age=31536000');

	/**
	 * Keep other origins from holding a handle on this window or reading its
	 * resources. The trailer opens in an iframe we control; nothing needs a
	 * cross-origin reference back to us.
	 */
	response.headers.set('cross-origin-opener-policy', 'same-origin');
	response.headers.set('cross-origin-resource-policy', 'same-origin');

	/**
	 * Default every response to uncacheable.
	 *
	 * Rendered pages embed the signed-in user's watchlist, and without an explicit
	 * directive a CDN or corporate proxy is free to apply its own heuristics — the
	 * failure mode being one person's private list served to the next visitor.
	 * Routes that *are* safe to share (the TMDB proxies) opt in by setting their
	 * own `cache-control`, so this only fills in the blanks.
	 */
	if (!response.headers.has('cache-control')) {
		response.headers.set('cache-control', 'private, no-store');
	}

	return response;
};

// The redirect runs first: a request to the old host has no business reaching
// the database, and the response it gets carries no body to protect.
export const handle = sequence(redirectRetiredHost, securityHeaders, authenticate);
