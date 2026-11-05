import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaResult } from '#lib/types.js';

const tmdb = vi.hoisted(() => ({ getTrending: vi.fn(), getRecommendations: vi.fn() }));
vi.mock('#lib/server/tmdb/index.js', () => tmdb);

const { GET } = await import('./+server');

function title(tmdbId: number, name: string, over: Partial<MediaResult> = {}): MediaResult {
	return {
		tmdbId,
		mediaType: 'movie',
		title: name,
		posterPath: `/${tmdbId}.jpg`,
		releaseDate: '2026-01-01',
		overview: 'A plot.',
		voteAverage: 7,
		...over
	};
}

async function sitemap() {
	const response = await GET({ url: new URL('https://nextsode.test/sitemap.xml') } as never);
	return (response as Response).text();
}

const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

describe('sitemap.xml', () => {
	beforeEach(() => {
		tmdb.getTrending.mockReset();
		tmdb.getRecommendations.mockReset();
	});

	it('lists the static pages, trending and each trending title’s related row, once each', async () => {
		tmdb.getTrending.mockResolvedValue({
			results: [title(1, 'Dune'), title(2, 'Alien')],
			page: 1,
			hasMore: true
		});
		// Alien is both trending and related to Dune, and is listed once.
		tmdb.getRecommendations.mockImplementation(async (_type: string, id: number) =>
			id === 1 ? [title(2, 'Alien'), title(3, 'Arrival')] : [title(3, 'Arrival')]
		);

		const urls = locs(await sitemap());

		expect(urls).toEqual([
			'https://nextsode.test/',
			'https://nextsode.test/terms',
			'https://nextsode.test/privacy',
			'https://nextsode.test/title/movie/1-dune',
			'https://nextsode.test/title/movie/2-alien',
			'https://nextsode.test/title/movie/3-arrival'
		]);
		expect(new Set(urls).size).toBe(urls.length);
	});

	it('dates every entry', async () => {
		tmdb.getTrending.mockResolvedValue({ results: [title(1, 'Dune')], page: 1, hasMore: false });
		tmdb.getRecommendations.mockResolvedValue([]);

		const xml = await sitemap();
		const lastmods = [...xml.matchAll(/<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/g)];

		expect(lastmods).toHaveLength(locs(xml).length);
	});

	it('leaves out thin titles, whose pages are noindex', async () => {
		tmdb.getTrending.mockResolvedValue({
			results: [title(1, 'Dune'), title(4, 'Nothing', { overview: null, posterPath: null })],
			page: 1,
			hasMore: false
		});
		tmdb.getRecommendations.mockResolvedValue([]);

		expect(await sitemap()).not.toContain('4-nothing');
	});

	it('keeps the static pages and the other rows when TMDB fails', async () => {
		tmdb.getTrending.mockResolvedValue({
			results: [title(1, 'Dune'), title(2, 'Alien')],
			page: 1,
			hasMore: false
		});
		tmdb.getRecommendations.mockImplementation(async (_type: string, id: number) => {
			if (id === 1) throw new Error('TMDB down');
			return [title(3, 'Arrival')];
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(locs(await sitemap())).toContain('https://nextsode.test/title/movie/3-arrival');

		tmdb.getTrending.mockRejectedValue(new Error('TMDB down'));
		expect(locs(await sitemap())).toEqual([
			'https://nextsode.test/',
			'https://nextsode.test/terms',
			'https://nextsode.test/privacy'
		]);
	});
});
