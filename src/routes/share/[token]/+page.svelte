<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Seo from '$lib/components/Seo.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import MediaCard from '$lib/components/media/MediaCard.svelte';
	import PosterGrid from '$lib/components/media/PosterGrid.svelte';
	import { describeScope } from '$lib/domain/share';
	import { titlePath } from '$lib/format/title-url';
	import type { PageData } from './$types';

	/**
	 * Somebody else's list, read by somebody with no account.
	 *
	 * Strictly a reading. There is no control here that writes anything — not to
	 * the owner's list, which would be absurd, and not to the visitor's either,
	 * because a grid of save buttons would turn a thing that was shared into a
	 * form to fill in. The invitation to build a list of your own sits once, at
	 * the bottom, where somebody who read to the end will find it.
	 *
	 * Each tile links to that title's public page, which is where saving *is*
	 * offered — one title at a time, having actually looked at it.
	 */
	let { data }: { data: PageData } = $props();

	const list = $derived(data.list);

	/** How many posters load eagerly — the same reasoning as Discover's grid. */
	const EAGER_POSTERS = 6;

	const heading = $derived(`${list.ownerName}'s list`);
	const summary = $derived(describeScope(list.scope, list.counts));
</script>

<!--
	Never indexed, and said in three places: here, in `robots.txt`, and as a
	header on the response. The page needs no password, which is not the same as
	being for everybody — it was sent to particular people, and a copy in an
	index is one its owner cannot revoke.
-->
<Seo
	title={`${heading} — Nextsode`}
	description="A shared list of films and TV shows."
	origin={page.data.origin}
	path={`/share/${page.params.token}`}
	indexable={false}
/>

<div class="py-5 sm:py-8">
	<header class="mb-6">
		<p class="text-xs font-semibold tracking-wider text-ink-faint uppercase">Shared list</p>
		<h1 class="mt-1 font-display text-2xl font-extrabold text-ink sm:text-3xl">{heading}</h1>
		<p class="mt-1.5 text-sm text-ink-muted">{summary}</p>
	</header>

	{#if list.items.length === 0}
		<EmptyState
			icon="bookmark"
			title="Nothing here yet"
			hint={`${list.ownerName} hasn't added anything to this part of their list yet.`}
		/>
	{:else}
		<PosterGrid>
			{#each list.items as item, index (`${item.mediaType}:${item.tmdbId}`)}
				<MediaCard
					title={item.title}
					posterPath={item.posterPath}
					releaseDate={item.releaseDate}
					voteAverage={item.voteAverage}
					mediaType={item.mediaType}
					watched={item.watched}
					priority={index < EAGER_POSTERS}
					href={titlePath(item)}
				/>
			{/each}
		</PosterGrid>
	{/if}

	<!--
		The one thing this page asks of its reader, once, at the end.
		A save button on every tile would read as a form; this reads as an offer.
	-->
	<aside
		class="mt-8 flex flex-col items-center gap-3 rounded-2xl bg-surface/60 px-5 py-6 text-center ring-1 ring-line"
	>
		<Icon name="bookmark" size={22} class="text-ink-faint" />
		<p class="text-sm font-semibold text-ink">Want a list like this one?</p>
		<p class="max-w-md text-sm text-ink-muted">
			Nextsode keeps track of what you mean to watch and where you are in every series — down to the
			episode. It's free.
		</p>
		<a
			href={resolve('/')}
			class="mt-1 flex min-h-11 items-center justify-center rounded-xl bg-brand px-5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-brand-hi"
		>
			Start your own
		</a>
	</aside>
</div>
