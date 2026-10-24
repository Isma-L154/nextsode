import { afterEach, describe, expect, it, vi } from 'vitest';
import { detailsUrl } from '#lib/format/details-url.js';

/**
 * The URL builder is tested here; the class itself needs `$state`, so its
 * behaviour is covered by the browser suite. This is the part that decides what
 * gets asked for, and it is pure.
 */

afterEach(() => vi.restoreAllMocks());

describe('detailsUrl', () => {
	const base = { tmdbId: 125988, mediaType: 'tv' as const, country: 'ES', season: null };

	it('asks only for the details when no season is tracked', () => {
		expect(detailsUrl(base)).toBe('/api/details/tv/125988?country=ES');
	});

	/** Episodes ride along on the same request rather than costing a second one. */
	it('appends the tracked season', () => {
		expect(detailsUrl({ ...base, season: 2 })).toBe('/api/details/tv/125988?country=ES&season=2');
	});

	// Season 0 is "Specials" and is never tracked, so it must not be requested.
	it('treats season zero as no season', () => {
		expect(detailsUrl({ ...base, season: 0 })).toBe('/api/details/tv/125988?country=ES');
	});

	it('encodes the country rather than interpolating it raw', () => {
		expect(detailsUrl({ ...base, country: 'a&b=c' })).toContain('country=a%26b%3Dc');
	});
});
