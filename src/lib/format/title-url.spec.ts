import { describe, expect, it } from 'vitest';
import { parseTitleSlug, slugify, titlePath, titleSlug } from './title-url';

describe('slugify', () => {
	it('lowercases and joins words with hyphens', () => {
		expect(slugify('The Dark Knight')).toBe('the-dark-knight');
	});

	it('strips accents rather than percent-encoding them', () => {
		expect(slugify('Amélie')).toBe('amelie');
		expect(slugify('El Laberinto del Fauno')).toBe('el-laberinto-del-fauno');
	});

	it('collapses the punctuation film titles are full of', () => {
		expect(slugify('Spider-Man: No Way Home')).toBe('spider-man-no-way-home');
		expect(slugify("Ocean's Eleven")).toBe('ocean-s-eleven');
		expect(slugify('WALL·E')).toBe('wall-e');
	});

	it('leaves no leading or trailing hyphen', () => {
		expect(slugify('...And Justice for All')).toBe('and-justice-for-all');
		expect(slugify('¿Quién?')).toBe('quien');
	});

	it('caps the length so the URL stays readable', () => {
		const long = 'Everything Everywhere All At Once And Then Some More Words Again';
		expect(slugify(long).split('-')).toHaveLength(8);
	});

	// The bare id is a working URL; a path of percent escapes is not.
	it('gives an empty string when nothing survives', () => {
		expect(slugify('千と千尋の神隠し')).toBe('');
	});
});

describe('titleSlug', () => {
	it('puts the id first, because the id is the address', () => {
		expect(titleSlug(157336, 'Interstellar')).toBe('157336-interstellar');
	});

	it('falls back to the bare id when the title slugifies to nothing', () => {
		expect(titleSlug(129, '千と千尋の神隠し')).toBe('129');
	});
});

describe('titlePath', () => {
	it('keeps movies and shows apart', () => {
		expect(titlePath({ tmdbId: 157336, mediaType: 'movie', title: 'Interstellar' })).toBe(
			'/title/movie/157336-interstellar'
		);
		expect(titlePath({ tmdbId: 1396, mediaType: 'tv', title: 'Breaking Bad' })).toBe(
			'/title/tv/1396-breaking-bad'
		);
	});
});

describe('parseTitleSlug', () => {
	it('reads the id and ignores the words after it', () => {
		expect(parseTitleSlug('157336-interstellar')).toBe(157336);
		expect(parseTitleSlug('157336')).toBe(157336);
	});

	// A retitled film must keep resolving: the link is already in someone's chat.
	it('accepts a stale spelling of the title', () => {
		expect(parseTitleSlug('157336-some-older-name')).toBe(157336);
	});

	it('rejects anything that is not an id', () => {
		expect(parseTitleSlug('interstellar')).toBeNull();
		expect(parseTitleSlug('')).toBeNull();
		expect(parseTitleSlug('-157336')).toBeNull();
		expect(parseTitleSlug('0-nothing')).toBeNull();
	});

	// Each of these is a second spelling of an id we already have a URL for, and
	// letting them through would put duplicates of one page into the index.
	it('rejects spellings that would duplicate a canonical URL', () => {
		expect(parseTitleSlug('007-bond')).toBeNull();
		expect(parseTitleSlug('157336.5')).toBeNull();
		expect(parseTitleSlug('1e5-scientific')).toBeNull();
	});

	it('rejects an id too large to be exact', () => {
		expect(parseTitleSlug('9007199254740993')).toBeNull();
	});
});
