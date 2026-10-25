import { env } from 'cloudflare:workers';
import { error, type RequestEvent } from '@sveltejs/kit';

/**
 * Ceilings on how often one caller may hit the routes that cost something.
 *
 * Three bindings, declared in `wrangler.jsonc`, one per kind of caller:
 *
 * - `API_RATE_LIMIT`, per visitor IP, on the public routes that spend the
 *   shared TMDB quota or read the database without a session.
 * - `AUTH_RATE_LIMIT`, per visitor IP and much tighter, on the sign-in flow. It
 *   holds no secret to guess, but every callback trades a code with Google and
 *   writes a session row.
 * - `ACCOUNT_RATE_LIMIT`, per signed-in account, on every form action. Writes
 *   need a session, so the account is the caller: a script with one cookie and
 *   many IPs still meets the same ceiling.
 *
 * Cloudflare's binding is approximate, and it is worth being specific about
 * how. The count is kept per location and per isolate, not globally — so the
 * ceiling a caller actually meets depends on how their requests are spread.
 * Measured against production: ninety requests over one reused connection are
 * cut off after about fifty, while the same ninety sent as separate
 * connections land on different isolates and none of them are refused.
 *
 * That is the right trade for the job, which is to stop one loop draining a
 * shared TMDB quota or database — a loop reuses its connection. It is not a
 * defence against a distributed caller, and nothing here should be read as one.
 */
export type RateLimitBinding = 'API_RATE_LIMIT' | 'AUTH_RATE_LIMIT' | 'ACCOUNT_RATE_LIMIT';

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
 * Whether `key` is over the binding's limit.
 *
 * Two ways this answers no without asking, both deliberate. Locally there is no
 * client IP, and failing closed would break `npm run dev` for everyone. In
 * production, a limiter that throws would turn a limiter outage into a site
 * outage — the route it guards is less critical than the site itself.
 */
export async function isRateLimited(
	binding: RateLimitBinding,
	key: string | null
): Promise<boolean> {
	const limiter = env[binding];
	if (!limiter || !key) return false;

	try {
		const { success } = await limiter.limit({ key });
		return !success;
	} catch (err) {
		console.error('Rate limiter unavailable, allowing the request:', err);
		return false;
	}
}

export const TOO_MANY_REQUESTS = 'Too many requests. Please slow down and try again shortly.';

/**
 * Apply a per-visitor limit, keyed by IP unless the route names a better key.
 *
 * @throws a 429 when the caller is over the limit.
 */
export async function enforceRateLimit(
	event: RequestEvent,
	binding: RateLimitBinding = 'API_RATE_LIMIT',
	key: string | null = visitorKey(event)
): Promise<void> {
	if (await isRateLimited(binding, key)) error(429, TOO_MANY_REQUESTS);
}
