import type { RequestHandler } from './$types';

/**
 * `robots.txt`, served rather than shipped as a static file.
 *
 * It used to be one, and it carried the only hand-written absolute URL left in
 * the project — a `Sitemap:` line naming the host. That went stale the moment
 * the app moved domains, silently, in the one file whose whole job is to tell a
 * crawler where to look. Deriving the host from the request removes the class
 * of mistake: every other canonical on the site is already built this way.
 */
const RULES = [
	'# Everything public is crawlable; the exclusions below are the parts that are',
	'# not pages at all.',
	'User-agent: *',
	'# The TMDB proxy spends a shared, rate-limited API quota.',
	'Disallow: /api/',
	'# Sign-in only ever produces redirects.',
	'Disallow: /auth/',
	'# A private list signed in, a sign-in prompt signed out. Neither is a result.',
	'Disallow: /watchlist',
	"# One person's calendar feed, reachable only by a secret nobody should publish.",
	'Disallow: /calendar/',
	'# A shared list: no password, but sent to particular people. An indexed copy',
	'# is one its owner cannot revoke.',
	'Disallow: /share/'
];

export const GET: RequestHandler = ({ url, setHeaders }) => {
	setHeaders({
		'content-type': 'text/plain; charset=utf-8',
		'cache-control': 'public, max-age=3600'
	});

	return new Response(`${RULES.join('\n')}\n\nSitemap: ${url.origin}/sitemap.xml\n`);
};
