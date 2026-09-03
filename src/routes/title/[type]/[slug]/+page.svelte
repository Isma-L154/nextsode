<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Seo from '$lib/components/Seo.svelte';
	import TitleDetail from '$lib/components/media/TitleDetail.svelte';
	import SaveControl from '$lib/components/media/SaveControl.svelte';
	import ShareButton from '$lib/components/media/ShareButton.svelte';
	import { titleSchema } from '$lib/format/seo';
	import { titlePath } from '$lib/format/title-url';
	import { backdropUrl, posterUrl, releaseYear } from '$lib/format/tmdb-image';
	import type { PageData } from './$types';

	/**
	 * A title's own page — the thing a share link points at.
	 *
	 * The same content as the detail sheet, deliberately: someone who follows a
	 * link here and then signs up should recognise what they already saw. What is
	 * missing is what belongs to a list rather than to a title — season and
	 * episode progress — because there is no list here to be at a position in.
	 *
	 * Saving is offered rather than withheld. This page is where most people will
	 * meet the app for the first time, and "you can keep this" is the honest next
	 * step; signed out, `SaveControl` renders the sign-in prompt instead. Either
	 * way it writes to the visitor's own list and cannot touch anyone else's.
	 */
	let { data }: { data: PageData } = $props();

	const details = $derived(data.details);
	const signedIn = $derived(Boolean(page.data.user));

	const path = $derived(titlePath(details));
	const shareUrl = $derived(`${page.data.origin}${path}`);

	const year = $derived(releaseYear(details.releaseDate));
	const kind = $derived(details.mediaType === 'movie' ? 'Movie' : 'TV series');

	/** "Interstellar (2014) — Movie | Nextsode": what it is, when, and whose page. */
	const metaTitle = $derived(`${details.title}${year ? ` (${year})` : ''} — ${kind} | Nextsode`);

	/**
	 * The synopsis, trimmed to what a result and a chat card actually render.
	 *
	 * Cut at a word boundary rather than mid-syllable, and only when there is
	 * something to cut — a short synopsis is left exactly as TMDB wrote it.
	 */
	const metaDescription = $derived.by(() => {
		const overview = details.overview?.trim();
		if (!overview) {
			return `Where to watch ${details.title}${year ? ` (${year})` : ''}, plus cast, rating and release details — and add it to your watchlist on Nextsode.`;
		}
		if (overview.length <= 160) return overview;
		const clipped = overview.slice(0, 157);
		return `${clipped.slice(0, clipped.lastIndexOf(' '))}…`;
	});

	/**
	 * The backdrop at card width, falling back to the poster.
	 *
	 * A poster is the wrong shape for a 1.91:1 card and will be cropped to its
	 * middle, which is still the film — better than the house image, which is not.
	 */
	const cardImage = $derived(
		backdropUrl(details.backdropPath, 'w1280') ?? posterUrl(details.posterPath, 'w500')
	);

	/**
	 * Following an actor's other work loads that title's page.
	 *
	 * A real navigation, not a swapped sheet: this page is a document, and the
	 * next title deserves its own URL — shareable, indexable and reachable with
	 * the back button.
	 */
	async function openTitle(item: { tmdbId: number; mediaType: 'movie' | 'tv'; title: string }) {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- built by titlePath, which owns this route's shape
		await goto(titlePath(item));
	}
</script>

<Seo
	title={metaTitle}
	description={metaDescription}
	origin={page.data.origin}
	{path}
	image={cardImage}
	imageAlt={`${details.title} — ${kind.toLowerCase()} artwork`}
	type={details.mediaType === 'movie' ? 'video.movie' : 'video.tv_show'}
	schema={titleSchema(page.data.origin, path, {
		title: details.title,
		mediaType: details.mediaType,
		overview: details.overview,
		releaseDate: details.releaseDate,
		genres: details.genres,
		voteAverage: details.voteAverage,
		voteCount: details.voteCount,
		image: cardImage,
		cast: details.cast
	})}
/>

<!--
	Held to the width of the detail sheet rather than the width of the grid.
	This is one thing to read, and a synopsis running the full width of a desktop
	is a synopsis nobody finishes.
-->
<div class="mx-auto max-w-2xl py-5 sm:py-8">
	<article class="overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
		<TitleDetail {details} heading="h1" onSelectTitle={openTitle}>
			{#snippet actions()}
				<SaveControl {details} saved={data.saved} {signedIn} />
				<ShareButton url={shareUrl} title={details.title} />
			{/snippet}
		</TitleDetail>
	</article>
</div>
