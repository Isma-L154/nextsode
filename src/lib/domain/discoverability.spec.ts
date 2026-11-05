import { describe, expect, it } from 'vitest';
import { isThinTitle, relatedTitles } from './discoverability';
import type { MediaResult } from '../types';

function title(tmdbId: number, over: Partial<MediaResult> = {}): MediaResult {
	return {
		tmdbId,
		mediaType: 'movie',
		title: `Title ${tmdbId}`,
		posterPath: `/poster-${tmdbId}.jpg`,
		releaseDate: '2020-01-01',
		overview: 'Something happens.',
		voteAverage: 7,
		...over
	};
}

describe('isThinTitle', () => {
	it('is thin with neither a synopsis nor a poster', () => {
		expect(isThinTitle({ overview: '  ', posterPath: null })).toBe(true);
		expect(isThinTitle({ overview: null, posterPath: null })).toBe(true);
	});

	it('is not thin with either one', () => {
		expect(isThinTitle({ overview: 'A plot.', posterPath: null })).toBe(false);
		expect(isThinTitle({ overview: null, posterPath: '/p.jpg' })).toBe(false);
	});
});

describe('relatedTitles', () => {
	it('drops the title itself, posterless titles and repeats', () => {
		const items = [
			title(1),
			title(2),
			title(3, { posterPath: null }),
			title(2),
			title(1, { mediaType: 'tv' })
		];

		const related = relatedTitles(items, { tmdbId: 1, mediaType: 'movie' });

		expect(related.map((item) => `${item.tmdbId}:${item.mediaType}`)).toEqual(['2:movie', '1:tv']);
	});

	it('caps the row', () => {
		const items = Array.from({ length: 30 }, (_, index) => title(index + 10));

		expect(relatedTitles(items, { tmdbId: 1, mediaType: 'movie' })).toHaveLength(12);
	});
});
