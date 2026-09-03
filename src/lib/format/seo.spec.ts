import { describe, expect, it } from 'vitest';
import { pageSchema, schemaScript, serializeSchema, siteSchema, titleSchema } from './seo';

describe('serializeSchema', () => {
	it('produces JSON a parser reads back unchanged', () => {
		const schema = { '@type': 'WebApplication', name: 'Nextsode' };
		expect(JSON.parse(serializeSchema(schema))).toEqual(schema);
	});

	/**
	 * The whole point: embedded in a page, an unescaped closing tag would end the
	 * script element early and turn everything after it into markup.
	 */
	it('leaves no literal closing tag in the output', () => {
		const output = serializeSchema({ name: '</script><img onerror=alert(1)>' });

		expect(output).not.toContain('</script>');
		expect(output).not.toContain('<');
		// Still the same string once parsed — escaped, not stripped.
		expect(JSON.parse(output).name).toBe('</script><img onerror=alert(1)>');
	});

	it('escapes a bracket wherever it appears', () => {
		expect(serializeSchema({ url: 'https://example.com/<' })).not.toContain('<');
	});
});

describe('schemaScript', () => {
	it('wraps the data in a typed script element', () => {
		const html = schemaScript({ '@type': 'WebApplication' });
		expect(html.startsWith('<script type="application/ld+json">')).toBe(true);
		expect(html.endsWith('</script>')).toBe(true);
	});

	// Exactly one closing tag: the element's own, never one smuggled in by data.
	it('cannot be closed early by its own content', () => {
		const html = schemaScript({ name: '</script><script>alert(1)</script>' });
		expect(html.split('</script>')).toHaveLength(2);
	});
});

const ORIGIN = 'https://nextsode.example';

/** Pull one node out of the site graph by its schema.org type. */
function node(type: string): Record<string, unknown> {
	const graph = siteSchema(ORIGIN)['@graph'] as Record<string, unknown>[];
	const found = graph.find((entry) => entry['@type'] === type);
	if (!found) throw new Error(`no ${type} node in the site graph`);
	return found;
}

describe('siteSchema', () => {
	it('describes the site and the app as one graph', () => {
		const graph = siteSchema(ORIGIN)['@graph'] as Record<string, unknown>[];
		expect(graph.map((entry) => entry['@type'])).toEqual(['WebSite', 'WebApplication']);
	});

	it('names the site, which is what a result gets titled with', () => {
		// Without this Google infers a name from the domain or the title, which is
		// a guess about the product rather than a statement of it.
		expect(node('WebSite').name).toBe('Nextsode');
	});

	it('declares the forms people actually type', () => {
		expect(node('WebSite').alternateName).toContain('Nextsode Watchlist');
		expect(node('WebApplication').alternateName).toContain('Nextsode Movies and TV');
	});

	it('points both nodes at somewhere the name is corroborated', () => {
		const repo = 'https://github.com/Isma-L154/nextsode';
		expect(node('WebSite').sameAs).toEqual([repo]);
		expect(node('WebApplication').sameAs).toEqual([repo]);
	});

	it('ties the app to the site rather than leaving them unrelated', () => {
		expect(node('WebApplication').isPartOf).toEqual({ '@id': `${ORIGIN}/#website` });
	});

	it('gives every node a stable id built from the deployment origin', () => {
		expect(node('WebSite')['@id']).toBe(`${ORIGIN}/#website`);
		expect(node('WebApplication')['@id']).toBe(`${ORIGIN}/#app`);
	});

	it('follows the origin, so a custom domain rewrites itself', () => {
		const graph = siteSchema('https://nextsode.app')['@graph'] as Record<string, unknown>[];
		expect(graph.every((entry) => String(entry['@id']).startsWith('https://nextsode.app'))).toBe(
			true
		);
	});

	it('still says the app is free', () => {
		expect(node('WebApplication').offers).toEqual({
			'@type': 'Offer',
			price: '0',
			priceCurrency: 'USD'
		});
	});

	it('survives being embedded in HTML', () => {
		expect(() => JSON.parse(serializeSchema(siteSchema(ORIGIN)))).not.toThrow();
	});
});

describe('pageSchema', () => {
	const terms = pageSchema(ORIGIN, '/terms', 'Terms of Use — Nextsode', 'The terms.');

	it('carries the page its own identity', () => {
		expect(terms['@type']).toBe('WebPage');
		expect(terms['@id']).toBe(`${ORIGIN}/terms#page`);
		expect(terms.url).toBe(`${ORIGIN}/terms`);
		expect(terms.name).toBe('Terms of Use — Nextsode');
	});

	it('points back at the site, which is the only reason it is here', () => {
		expect(terms.isPartOf).toEqual({ '@id': `${ORIGIN}/#website` });
		expect(terms.about).toEqual({ '@id': `${ORIGIN}/#app` });
	});

	it('references the same site node the homepage defines', () => {
		const graph = siteSchema(ORIGIN)['@graph'] as Record<string, unknown>[];
		const website = graph.find((entry) => entry['@type'] === 'WebSite');
		expect((terms.isPartOf as { '@id': string })['@id']).toBe(website!['@id']);
	});
});

describe('titleSchema', () => {
	const interstellar = {
		title: 'Interstellar',
		mediaType: 'movie' as const,
		overview: 'A team travels through a wormhole.',
		releaseDate: '2014-11-05',
		genres: ['Adventure', 'Drama', 'Science Fiction'],
		voteAverage: 8.7,
		voteCount: 36000,
		image: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
		cast: [{ name: 'Matthew McConaughey' }, { name: 'Anne Hathaway' }]
	};

	const schema = titleSchema(ORIGIN, '/title/movie/157336-interstellar', interstellar);

	it('describes a film as a Movie and a show as a TVSeries', () => {
		expect(schema['@type']).toBe('Movie');
		expect(
			titleSchema(ORIGIN, '/title/tv/1396-breaking-bad', {
				...interstellar,
				mediaType: 'tv'
			})['@type']
		).toBe('TVSeries');
	});

	it('carries the title its own identity and URL', () => {
		expect(schema['@id']).toBe(`${ORIGIN}/title/movie/157336-interstellar#title`);
		expect(schema.url).toBe(`${ORIGIN}/title/movie/157336-interstellar`);
		expect(schema.name).toBe('Interstellar');
	});

	it('references the same site node every other page names', () => {
		const graph = siteSchema(ORIGIN)['@graph'] as Record<string, unknown>[];
		const website = graph.find((entry) => entry['@type'] === 'WebSite');
		expect((schema.isPartOf as { '@id': string })['@id']).toBe(website!['@id']);
	});

	// Out of ten, said out loud: read against a five-star scale, 8.7 would be a
	// claim nobody made.
	it('states the scale the rating is on, and the votes behind it', () => {
		expect(schema.aggregateRating).toEqual({
			'@type': 'AggregateRating',
			ratingValue: '8.7',
			bestRating: '10',
			worstRating: '0',
			ratingCount: 36000
		});
	});

	it('omits the rating when nobody has voted', () => {
		const unreleased = titleSchema(ORIGIN, '/title/movie/1-x', {
			...interstellar,
			voteAverage: 0,
			voteCount: 0
		});
		expect(unreleased).not.toHaveProperty('aggregateRating');
	});

	// A rating with no count behind it is the shape validators reject outright.
	it('omits the rating when TMDB gives an average with no votes', () => {
		const orphaned = titleSchema(ORIGIN, '/title/movie/1-x', {
			...interstellar,
			voteCount: 0
		});
		expect(orphaned).not.toHaveProperty('aggregateRating');
	});

	it('names the top of the bill rather than the whole cast', () => {
		const crowded = titleSchema(ORIGIN, '/title/movie/1-x', {
			...interstellar,
			cast: Array.from({ length: 12 }, (_, index) => ({ name: `Actor ${index}` }))
		});
		expect(crowded.actor).toHaveLength(5);
		expect((crowded.actor as { name: string }[])[0]).toEqual({
			'@type': 'Person',
			name: 'Actor 0'
		});
	});

	it('leaves out what TMDB has no answer for, rather than filling it in', () => {
		const bare = titleSchema(ORIGIN, '/title/movie/1-x', {
			title: 'Untitled',
			mediaType: 'movie',
			overview: null,
			releaseDate: null,
			genres: [],
			voteAverage: null,
			voteCount: 0,
			image: null,
			cast: []
		});

		for (const absent of ['description', 'datePublished', 'genre', 'image', 'actor']) {
			expect(bare).not.toHaveProperty(absent);
		}
		expect(bare.name).toBe('Untitled');
	});

	it('survives being embedded in HTML', () => {
		expect(() => JSON.parse(serializeSchema(schema))).not.toThrow();
	});
});
