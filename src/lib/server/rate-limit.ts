import { error, type RequestEvent } from '@sveltejs/kit';

/**
 * A ceiling on how often one visitor may hit the public TMDB proxies.
 *
 * Those endpoints answer without a session on purpose — browsing works signed
 * out — which makes them the only place a script can spend a shared,
 * rate-limited API quota on everyone else's behalf. The sign-in flow needs no
 * equivalent: it holds no secret to guess and Google does the authenticating.
 *
 * Cloudflare's binding is approximate, and it is worth being specific about
 * how. The count is kept per location and per isolate, not globally — so the
 * ceiling a caller actually meets depends on how their requests are spread.
 * Measured against production: ninety requests over one reused connection are
 * cut off after about fifty, while the same ninety sent as separate
 * connections land on different isolates and none of them are refused.
 *
 * That is the right trade for the job, which is to stop one loop draining a
 * shared TMDB quota — a loop reuses its connection. It is not a defence
 * against a distributed caller, and nothing here should be read as one.
 */

/**
 * Who is asking, as far as the edge can tell.
 *
 * `CF-Connecting-IP` is set by Cloudflare itself and cannot be spoofed by the
 * client — unlike `X-Forwarded-For`, which is just a request header anyone can
 * write. With no edge in front (local development, tests) there is nobody to
 * limit, and a single shared key would otherwise throttle the whole dev server
 * against itself.
 */
function visitorKey(event: RequestEvent): string | null {
	return event.request.headers.get('cf-connecting-ip');
}

/**
 * Apply the limit, or do nothing where it cannot be applied.
 *
 * Two ways this is a no-op, both deliberate. Locally there is no binding and no
 * client IP, and failing closed would break `npm run dev` for everyone. In
 * production, a limiter that throws would turn a limiter outage into a site
 * outage — the endpoint it guards is less critical than the site itself.
 *
 * @throws a 429 when the caller is over the limit.
 */
export async function enforceRateLimit(event: RequestEvent): Promise<void> {
	const limiter = event.platform?.env?.API_RATE_LIMIT;
	const key = visitorKey(event);
	if (!limiter || !key) return;

	try {
		const { success } = await limiter.limit({ key });
		if (success) return;
	} catch (err) {
		console.error('Rate limiter unavailable, allowing the request:', err);
		return;
	}

	// Outside the try on purpose: `error` throws, and catching it here would turn
	// the rejection into an allow.
	error(429, 'Too many requests. Please slow down and try again shortly.');
}
