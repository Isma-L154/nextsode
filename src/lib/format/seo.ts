/**
 * Serialise structured data for embedding in an HTML `<script>` element.
 *
 * Escaping the less-than sign is the standard treatment for JSON inside HTML: it
 * leaves the value byte-identical to any JSON parser while making a literal
 * closing script tag unrepresentable, so the data cannot end its own element and
 * become markup.
 *
 * Nothing fed to this is user-supplied today — the only outside value is the
 * request origin, which cannot contain a bracket — but the guard costs one pass
 * over a short string and removes the need to re-establish that every time the
 * schema grows a field.
 *
 * It lives here rather than in the component because Svelte's parser reads a
 * bare `<` in a component's script block as the start of a tag.
 */
export function serializeSchema(schema: Record<string, unknown>): string {
	return JSON.stringify(schema).replaceAll('<', '\\u003c');
}

/**
 * The complete `<script type="application/ld+json">` element for a page.
 *
 * The tag is built here rather than in the template for the same parser reason,
 * and it belongs with the escaping anyway: the reason `<` is escaped at all is
 * that the result goes inside this element, so splitting the two would leave
 * each half looking arbitrary.
 */
export function schemaScript(schema: Record<string, unknown>): string {
	return `<script type="application/ld+json">${serializeSchema(schema)}</script>`;
}

/** Where the project lives in public. The only corroborating source there is. */
const REPOSITORY_URL = 'https://github.com/Isma-L154/nextsode';

/** The product's own name, and the forms people will actually type. */
const BRAND = 'Nextsode';
const ALTERNATE_NAMES = ['Nextsode Watchlist', 'Nextsode Movies and TV'];

const TAGLINE =
	'A free watchlist for films and TV shows, with episode-level progress tracking and streaming availability.';

/**
 * How many billed actors a title's structured data names.
 *
 * The full cast is already capped at twelve upstream; this trims it further
 * because a schema listing every speaking part reads as keyword stuffing, and
 * the people who make a title findable are the ones at the top of the bill.
 */
const MAX_SCHEMA_CAST = 5;

/** Stable node ids, so pages can point at the site entity instead of redescribing it. */
const websiteId = (origin: string) => `${origin}/#website`;
const appId = (origin: string) => `${origin}/#app`;

/**
 * The site as one entity, described once.
 *
 * Two nodes rather than one, because they answer different questions. Google
 * reads `WebSite.name` to decide what to *call* this site in a result; without
 * it the name is inferred from the title or the domain. That used to matter
 * urgently, when the domain read `ilsproj` and named nothing — it matters less
 * on a domain of our own, and stating the name outright is still better than
 * leaving it to be guessed. `WebApplication` is what the site *is*.
 *
 * `sameAs` is the part that matters most here and the part that is easiest to
 * mistake for decoration. "Nextsode" is an invented word one letter away from
 * "next episode", so a search engine has no reason to treat it as a name rather
 * than a typo — until the same name shows up somewhere it already trusts,
 * pointing back. That is what this link is: corroboration, not a backlink.
 *
 * `alternateName` covers what people type instead of the bare word.
 *
 * Emitted as a `@graph` so the nodes can reference each other by `@id`; three
 * pages each shipping an unrelated object read as three sites, not one.
 */
export function siteSchema(origin: string): Record<string, unknown> {
	return {
		'@context': 'https://schema.org',
		'@graph': [
			{
				'@type': 'WebSite',
				'@id': websiteId(origin),
				name: BRAND,
				alternateName: ALTERNATE_NAMES,
				url: `${origin}/`,
				description: TAGLINE,
				inLanguage: 'en',
				sameAs: [REPOSITORY_URL]
			},
			{
				'@type': 'WebApplication',
				'@id': appId(origin),
				name: BRAND,
				alternateName: ALTERNATE_NAMES,
				url: `${origin}/`,
				applicationCategory: 'EntertainmentApplication',
				operatingSystem: 'Any',
				browserRequirements: 'Requires JavaScript.',
				description: TAGLINE,
				featureList: [
					'Track TV progress down to the episode',
					'Search films and TV shows by title or by actor',
					'See where to stream a title in your country',
					'Daily suggestions drawn from your own list'
				],
				isPartOf: { '@id': websiteId(origin) },
				sameAs: [REPOSITORY_URL],
				offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
			}
		]
	};
}

/**
 * A supporting page, tied back to the site it belongs to.
 *
 * Terms and Privacy will never rank for anything and are not meant to. They earn
 * their markup by being two more documents that name the same entity and point
 * at it — which is the whole problem a new brand has.
 */
export function pageSchema(
	origin: string,
	path: string,
	name: string,
	description: string
): Record<string, unknown> {
	return {
		'@context': 'https://schema.org',
		'@type': 'WebPage',
		'@id': `${origin}${path}#page`,
		name,
		description,
		url: `${origin}${path}`,
		inLanguage: 'en',
		isPartOf: { '@id': websiteId(origin) },
		about: { '@id': appId(origin) }
	};
}

/**
 * One title, described as the thing it is.
 *
 * `Movie` and `TVSeries` are the vocabulary a search engine already understands,
 * and they are what turns a shared link from a page with words on it into a
 * known film with a rating, a year and a cast. Nothing here is invented: every
 * field is TMDB's, and any it has no answer for is left out rather than filled
 * with a placeholder — an empty `aggregateRating` is worse than none, because a
 * validator reads it as a rating of zero.
 *
 * `isPartOf` ties each one back to the same site node the other pages name,
 * which is the whole reason these pages help the brand at all: a few hundred
 * documents corroborating one entity rather than a few hundred orphans.
 */
export function titleSchema(
	origin: string,
	path: string,
	title: {
		title: string;
		mediaType: 'movie' | 'tv';
		overview: string | null;
		releaseDate: string | null;
		genres: string[];
		voteAverage: number | null;
		/** Real votes only: the rating is dropped rather than counted at zero. */
		voteCount: number;
		image: string | null;
		cast: ReadonlyArray<{ name: string }>;
	}
): Record<string, unknown> {
	const url = `${origin}${path}`;

	return {
		'@context': 'https://schema.org',
		'@type': title.mediaType === 'movie' ? 'Movie' : 'TVSeries',
		'@id': `${url}#title`,
		name: title.title,
		url,
		inLanguage: 'en',
		isPartOf: { '@id': websiteId(origin) },
		...(title.overview && { description: title.overview }),
		...(title.releaseDate && { datePublished: title.releaseDate }),
		...(title.genres.length && { genre: title.genres }),
		...(title.image && { image: title.image }),
		...(title.cast.length && {
			actor: title.cast.slice(0, MAX_SCHEMA_CAST).map((member) => ({
				'@type': 'Person',
				name: member.name
			}))
		}),
		/**
		 * TMDB scores out of ten, and saying so is not optional: a bare `8.7` is
		 * read against the five-star scale most consumers assume, which turns a
		 * good film into a suspiciously perfect one.
		 *
		 * A count of zero drops the whole block. An unreleased film carries an
		 * average of 0 from nobody, and publishing that is claiming it was rated
		 * and found worthless.
		 */
		...(title.voteAverage &&
			title.voteCount > 0 && {
				aggregateRating: {
					'@type': 'AggregateRating',
					ratingValue: title.voteAverage.toFixed(1),
					bestRating: '10',
					worstRating: '0',
					ratingCount: title.voteCount
				}
			})
	};
}
