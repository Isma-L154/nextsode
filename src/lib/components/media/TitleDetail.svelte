<script lang="ts">
	import type { Snippet } from 'svelte';
	import DetailArtwork from './DetailArtwork.svelte';
	import DetailHeading from './DetailHeading.svelte';
	import ReleaseBanner from './ReleaseBanner.svelte';
	import AddToCalendar from './AddToCalendar.svelte';
	import WatchProviders from './WatchProviders.svelte';
	import CastRow from './CastRow.svelte';
	import type { MediaDetails, MediaResult } from '$lib/types';

	/**
	 * Everything known about one title, in the order it is worth knowing it.
	 *
	 * Extracted from the detail sheet when titles gained a public page of their
	 * own. The two are the same content in different frames — a sheet over the
	 * app, and a document a stranger arrives at from a link — and the moment they
	 * were two files they started to drift: a field added to the synopsis band
	 * would appear in one and not the other, and nobody would notice, because
	 * nobody looks at both at once.
	 *
	 * What differs between the two is passed in rather than branched on here.
	 * Progress controls exist only where there is a list to record progress
	 * against, and the actions under the synopsis are a save button in one place
	 * and a save button plus a share link in the other — so both are snippets,
	 * and this file stays a running order rather than a set of conditions.
	 */
	interface Props {
		details: MediaDetails;
		/** `h1` on the title's own page, `h2` inside the sheet. See `DetailHeading`. */
		heading?: 'h1' | 'h2';
		/** Season and episode controls, when the viewer has this title on a list. */
		progress?: Snippet;
		/** Save, share — whatever this frame offers once the reading is done. */
		actions?: Snippet;
		/** Following a cast member's other work to that title. */
		onSelectTitle: (item: MediaResult) => void;
	}

	let { details, heading = 'h2', progress, actions, onSelectTitle }: Props = $props();
</script>

<DetailArtwork {details} />

<!-- Pulled up over the artwork, which is why the heading carries its own
     top padding rather than this container doing it. -->
<div class="relative -mt-14 px-4 pb-8 sm:px-6">
	<DetailHeading {details} level={heading} />
	<ReleaseBanner {details} />
	<!-- Directly under the banner that says it is not out yet: that is the
	     sentence this answers. -->
	<AddToCalendar {details} />

	{@render progress?.()}

	{#if details.watch}
		<WatchProviders watch={details.watch} title={details.title} />
	{/if}

	{#if details.genres.length}
		<div class="mt-5 flex flex-wrap gap-2">
			{#each details.genres as genre (genre)}
				<span
					class="rounded-full bg-surface-hi px-3 py-1 text-xs font-medium text-ink-muted ring-1 ring-line"
				>
					{genre}
				</span>
			{/each}
		</div>
	{/if}

	{#if details.tagline}
		<p class="mt-4 text-sm text-ink-muted italic">“{details.tagline}”</p>
	{/if}

	{#if details.overview}
		<p class="mt-3 text-sm leading-relaxed text-ink-muted">{details.overview}</p>
	{/if}

	{@render actions?.()}

	<CastRow cast={details.cast} title={details} {onSelectTitle} />
</div>
