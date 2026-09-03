<script lang="ts">
	import { schemaScript } from '$lib/format/seo';

	/**
	 * The tags that decide how a page looks outside the app.
	 *
	 * Two audiences, one set of tags. Search engines read the title, description
	 * and canonical; every chat app, forum and social network reads the Open Graph
	 * block and renders a card from it. Without the second, a link pasted anywhere
	 * arrives as a bare URL — which is a bigger loss than search ranking for a site
	 * that people will mostly hear about from each other.
	 *
	 * The origin is passed in from the request rather than hard-coded, so moving to
	 * a custom domain rewrites every canonical and card URL without touching a
	 * line here.
	 */
	interface Props {
		title: string;
		description: string;
		/** Absolute origin of this deployment, resolved server-side. */
		origin: string;
		/** The path this page canonically lives at, leading slash included. */
		path: string;
		/**
		 * Whether search engines should index this page.
		 *
		 * A signed-out visitor's My List is a sign-in prompt wearing a page's URL.
		 * Letting it into the index spends crawl budget to rank a locked door.
		 */
		indexable?: boolean;
		/** Structured data for the page, as a plain object. */
		schema?: Record<string, unknown>;
		/**
		 * The card image, absolute, when this page has one of its own.
		 *
		 * A title's page does: its backdrop is the single most persuasive thing
		 * about the link, and a shared film that arrives under the house artwork
		 * looks like an ad for the app rather than a recommendation of the film.
		 * Everywhere else falls back to `og.png`, which is what a page with no
		 * subject of its own should show.
		 */
		image?: string | null;
		/** Alternative text for that image, which the fallback already has. */
		imageAlt?: string;
		/**
		 * The Open Graph type. `video.movie` and `video.tv_show` are the vocabulary
		 * for exactly what these pages are; anything else on the site is a
		 * `website`.
		 */
		type?: 'website' | 'video.movie' | 'video.tv_show';
	}

	let {
		title,
		description,
		origin,
		path,
		indexable = true,
		schema,
		image: pageImage = null,
		imageAlt = 'Nextsode — never lose your place in a series.',
		type = 'website'
	}: Props = $props();

	/** The JSON-LD element, escaped so it cannot end itself. See `$lib/format/seo`. */
	const schemaJson = $derived(schema ? schemaScript(schema) : null);

	const canonical = $derived(`${origin}${path}`);
	// Absolute, because every consumer of these tags fetches the image from
	// somewhere that is not this page.
	const image = $derived(pageImage ?? `${origin}/og.png`);

	/**
	 * The declared dimensions belong to `og.png` alone.
	 *
	 * They exist so a card can be laid out before the image has loaded, and
	 * repeating them over a TMDB backdrop would be a claim we have not measured —
	 * worse than saying nothing, because a wrong size is a cropped card. TMDB
	 * backdrops are 16:9 and every consumer here reads that from the file.
	 */
	const ownImage = $derived(pageImage === null);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonical} />

	{#if !indexable}
		<meta name="robots" content="noindex, follow" />
	{/if}

	<meta property="og:type" content={type} />
	<meta property="og:site_name" content="Nextsode" />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonical} />
	<meta property="og:image" content={image} />
	{#if ownImage}
		<meta property="og:image:width" content="1200" />
		<meta property="og:image:height" content="630" />
	{/if}
	<meta property="og:image:alt" content={imageAlt} />
	<meta property="og:locale" content="en_US" />

	<!-- X and several others still read the twitter:* names rather than og:*. -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={image} />

	{#if schemaJson}
		<!--
			`@html` is the only way to emit a typed script element from a component,
			since Svelte claims any real script tag written here. The string is built
			in `$lib/format/seo` from JSON we construct and escape — never markup — so the
			rule suppressed below is guarding against something that cannot occur.
		-->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html schemaJson}
	{/if}
</svelte:head>
