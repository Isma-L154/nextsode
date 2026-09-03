import { getTrending } from '$lib/server/tmdb';
import { titlePath } from '$lib/format/title-url';
import type { RequestHandler } from './$types';

/**
 * The public surface: the home page, the two legal ones, and the titles.
 *
 * It used to be three URLs, because there was nothing else a stranger could
 * open. Titles changed that — every film and show now has a page of its own —
 * and a sitemap is how a crawler learns that a section exists at all, since
 * nothing on the home page links into it until somebody shares a link.
 *
 * Which titles, though, is a real question: there are a million of them and
 * enumerating TMDB would be both rude and useless. This lists what is trending
 * this week, which is the set most likely to be searched for this week, and
 * lets the rest be discovered from shared links and from the cast rows that
 * connect one title to another.
 *
 * Everything still private (a list), a redirect (sign-in) or a proxy (the API)
 * stays out: listing those would spend crawl budget to have each one rejected.
 *
 * Built from the request origin so a move to a custom domain needs no edit here.
 */
const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400';

/** Path, how often it is worth re-reading, and its weight relative to the rest. */
interface Entry {
	path: string;
	changefreq: string;
	priority: string;
}

const PAGES: ReadonlyArray<Entry> = [
	{ path: '/', changefreq: 'daily', priority: '1.0' },
	{ path: '/terms', changefreq: 'yearly', priority: '0.3' },
	{ path: '/privacy', changefreq: 'yearly', priority: '0.3' }
];

/**
 * How many trending pages to walk. Two is forty titles — enough to be worth
 * fetching, small enough that a sitemap request stays one or two API calls.
 */
const TRENDING_PAGES = 2;

/**
 * The trending titles, or none at all.
 *
 * A sitemap that fails is worse than a short one: a crawler reads a 500 as "come
 * back later" and may stop trusting the file. So a TMDB outage costs the title
 * entries and nothing else — the three static pages are still served, which is
 * exactly what this file did before titles existed.
 */
async function trendingEntries(): Promise<Entry[]> {
	try {
		const pages = await Promise.all(
			Array.from({ length: TRENDING_PAGES }, (_, index) => getTrending(index + 1))
		);

		return pages
			.flatMap((page) => page.results)
			.map((item) => ({
				// Weekly, because that is how often the underlying details change in
				// any way a crawler would care about: a new rating, a new provider.
				path: titlePath(item),
				changefreq: 'weekly',
				priority: '0.6'
			}));
	} catch (err) {
		console.error('Sitemap trending fetch failed:', err);
		return [];
	}
}

export const GET: RequestHandler = async ({ url }) => {
	const entries = [...PAGES, ...(await trendingEntries())]
		.map(
			({ path, changefreq, priority }) => `	<url>
		<loc>${url.origin}${path}</loc>
		<changefreq>${changefreq}</changefreq>
		<priority>${priority}</priority>
	</url>`
		)
		.join('\n');

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;

	return new Response(body, {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			'cache-control': CACHE_CONTROL
		}
	});
};
