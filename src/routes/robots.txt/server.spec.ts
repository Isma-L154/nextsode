import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

/**
 * `robots.txt` exists to point a crawler at the sitemap and to keep it out of
 * the routes that are not pages. Both halves fail quietly: a stale host sends
 * every crawler to a sitemap that is not there, and a missing `Disallow` is
 * only noticed once something private is in an index.
 */
async function fetchRobots(origin: string) {
	const setHeaders = vi.fn();
	const response = await GET({ url: new URL(origin), setHeaders } as never);
	return { body: await (response as Response).text(), setHeaders };
}

function parseGroups(body: string) {
	const groups: { userAgents: string[]; rules: string[] }[] = [];

	for (const rawLine of body.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#') || line.startsWith('Sitemap:')) continue;

		if (line.startsWith('User-agent: ')) {
			let group = groups.at(-1);
			if (!group || group.rules.length > 0) {
				group = { userAgents: [], rules: [] };
				groups.push(group);
			}
			group.userAgents.push(line.slice('User-agent: '.length));
		} else {
			groups.at(-1)?.rules.push(line);
		}
	}

	return groups;
}

describe('robots.txt', () => {
	it('advertises the sitemap at the host it was asked from', async () => {
		const { body } = await fetchRobots('https://nextsode.cloudils.com/robots.txt');

		expect(body).toContain('Sitemap: https://nextsode.cloudils.com/sitemap.xml');
	});

	it('follows the host rather than naming one', async () => {
		// The reason this is a route and no longer a static file: the old one had
		// the host written into it, and moving domains left it pointing at a
		// sitemap that had gone.
		const { body } = await fetchRobots('https://preview.example.test/robots.txt');

		expect(body).toContain('Sitemap: https://preview.example.test/sitemap.xml');
		expect(body).not.toContain('cloudils');
		expect(body).not.toContain('workers.dev');
	});

	it('keeps crawlers out of everything that is not a page', async () => {
		const { body } = await fetchRobots('https://nextsode.cloudils.com/robots.txt');

		// Each of these is a decision with a reason, not a default: a metered TMDB
		// proxy, a route that only redirects, a private list, one person's calendar
		// feed, and a list shared with particular people rather than with everyone.
		for (const path of ['/api/', '/auth/', '/watchlist', '/calendar/', '/share/']) {
			expect(body).toContain(`Disallow: ${path}`);
		}
	});

	// Titles are the one thing here that *should* rank. They hold no private
	// data, and they are the only public surface the app has beyond its homepage.
	it('leaves title pages open to crawlers', async () => {
		const { body } = await fetchRobots('https://nextsode.cloudils.com/robots.txt');

		expect(body).not.toContain('Disallow: /title');
	});

	it('lets everything else be crawled', async () => {
		const { body } = await fetchRobots('https://nextsode.cloudils.com/robots.txt');
		const group = parseGroups(body).find(({ userAgents }) => userAgents.includes('*'));

		expect(group).toBeDefined();
		expect(group?.rules).not.toContain('Disallow: /');
	});

	it.each([
		'SERankingBacklinksBot',
		'MJ12bot',
		'SemrushBot',
		'AhrefsBot',
		'DotBot',
		'panscient.com',
		'GPTBot',
		'CCBot',
		'Amazonbot',
		'Bytespider',
		'ElevenlabsCrawler',
		'RiverBot'
	])('excludes %s from the whole site', async (userAgent) => {
		const { body } = await fetchRobots('https://nextsode.cloudils.com/robots.txt');
		const group = parseGroups(body).find(({ userAgents }) => userAgents.includes(userAgent));

		expect(group?.rules).toEqual(['Disallow: /']);
	});

	it.each([
		'Googlebot',
		'Bingbot',
		'OAI-SearchBot',
		'ChatGPT-User',
		'PerplexityBot',
		'Amzn-SearchBot',
		'ExaSearchBot'
	])('keeps %s under the wildcard rules', async (userAgent) => {
		const { body } = await fetchRobots('https://nextsode.cloudils.com/robots.txt');

		expect(body).not.toContain(userAgent);
	});

	it('is served as plain text', async () => {
		const { setHeaders } = await fetchRobots('https://nextsode.cloudils.com/robots.txt');

		// A crawler that is handed HTML treats the file as absent.
		expect(setHeaders).toHaveBeenCalledWith(
			expect.objectContaining({ 'content-type': 'text/plain; charset=utf-8' })
		);
	});
});
