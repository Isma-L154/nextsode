import { getRecommendations, getTrending } from '#lib/server/tmdb/index.js';
import { isThinTitle, relatedTitles } from '#lib/domain/discoverability.js';
import { uniqueBy } from '#lib/domain/media.js';
import { titlePath } from '#lib/format/title-url.js';
import type { MediaResult } from '#lib/types.js';
import type { RequestHandler } from './$types';

/**
 * The public surface: the home page, the two legal ones, and the titles a
 * crawler can actually reach by following links.
 *
 * Not every title — there are a million of them, and a sitemap URL that no page
 * links to is one Google leaves unknown. So it lists the first page of trending,
 * which the home page renders as links, and each of those titles' "More like
 * this" row, which their pages render as links. Everything else is found the
 * same way, one link at a time.
 *
 * Everything still private (a list), a redirect (sign-in) or a proxy (the API)
 * stays out: listing those would spend crawl budget to have each one rejected.
 *
 * Built from the request origin so a move to a custom domain needs no edit here.
 */
const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400';

/** When the legal pages last changed: the date each one states at its top. */
const LEGAL_UPDATED = '2026-09-20';

/** Path, when it last changed, how often it is worth re-reading, and its weight. */
interface Entry {
	path: string;
	lastmod: string;
	changefreq: string;
	priority: string;
}

/**
 * The titles linked from the home page and from their own pages.
 *
 * Thin titles are left out because their pages are `noindex`, and submitting a
 * page that refuses the index is an error in Search Console.
 *
 * A sitemap that fails is worse than a short one: a crawler reads a 500 as "come
 * back later" and may stop trusting the file. So a TMDB outage costs the title
 * entries and nothing else, and one failed row costs only that row.
 */
async function reachableTitles(): Promise<MediaResult[]> {
	try {
		const trending = (await getTrending(1)).results.filter((item) => !isThinTitle(item));
		const rows = await Promise.allSettled(
			trending.map(async (item) =>
				relatedTitles(await getRecommendations(item.mediaType, item.tmdbId), item)
			)
		);
		const related = rows.flatMap((row) => (row.status === 'fulfilled' ? row.value : []));
		return [...trending, ...related];
	} catch (err) {
		console.error('Sitemap trending fetch failed:', err);
		return [];
	}
}

export const GET: RequestHandler = async ({ url }) => {
	// Trending, ratings and providers are re-read daily, so today is when the
	// home page and the titles last changed.
	const today = new Date().toISOString().slice(0, 10);

	const pages: Entry[] = [
		{ path: '/', lastmod: today, changefreq: 'daily', priority: '1.0' },
		{ path: '/terms', lastmod: LEGAL_UPDATED, changefreq: 'yearly', priority: '0.3' },
		{ path: '/privacy', lastmod: LEGAL_UPDATED, changefreq: 'yearly', priority: '0.3' }
	];
	const titles: Entry[] = (await reachableTitles()).map((item) => ({
		path: titlePath(item),
		lastmod: today,
		changefreq: 'weekly',
		priority: '0.6'
	}));

	const entries = uniqueBy([...pages, ...titles], (entry) => entry.path)
		.map(
			({ path, lastmod, changefreq, priority }) => `	<url>
		<loc>${url.origin}${path}</loc>
		<lastmod>${lastmod}</lastmod>
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
