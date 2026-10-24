<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { resolve } from '$app/paths';
	import Icon from '#lib/components/ui/Icon.svelte';
	import MediaCard from './MediaCard.svelte';
	import { hasStarted, progressNote } from '#lib/domain/episodes.js';
	import type { MediaResult, SavedEntry } from '#lib/types.js';

	/**
	 * A discoverable title (trending or search result) with its save control.
	 *
	 * The three states are mutually exclusive: sign in, already saved, or save —
	 * so the footer never shows an action that cannot succeed.
	 */
	interface Props {
		item: MediaResult;
		/** The saved row when this title is already on the list, otherwise null. */
		saved: SavedEntry | null;
		signedIn: boolean;
		/** Forwarded to the poster; set for the tiles above the fold. */
		priority?: boolean;
		onSelect: () => void;
		onSubmit: SubmitFunction;
	}

	let { item, saved, signedIn, priority = false, onSelect, onSubmit }: Props = $props();

	/**
	 * A show already in progress shouldn't just say "in your list" here — the
	 * useful fact is how far in you are, so Discover stays honest about state you
	 * already have rather than making you switch tabs to find out.
	 */
	const note = $derived.by(() => {
		if (!saved) return undefined;
		const entry = { ...saved, mediaType: item.mediaType };
		// Unlike My List, a title with no progress says nothing here: the footer
		// already reads "In your list", and "Not started" would only repeat it.
		return hasStarted(entry) ? progressNote(entry) : undefined;
	});
</script>

<MediaCard
	title={item.title}
	posterPath={item.posterPath}
	releaseDate={item.releaseDate}
	voteAverage={item.voteAverage}
	mediaType={item.mediaType}
	watched={saved?.watched ?? false}
	{note}
	{priority}
	{onSelect}
>
	{#snippet actions()}
		{#if !signedIn}
			<a
				href={resolve('auth/google')}
				data-sveltekit-reload
				class="flex min-h-11 w-full items-center justify-center rounded-xl bg-surface-hi text-xs font-semibold text-ink-muted ring-1 ring-line transition-colors duration-200 ring-inset hover:bg-line hover:text-ink"
			>
				Sign in to save
			</a>
		{:else if saved}
			<span
				class="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-mint/12 text-xs font-semibold text-mint"
			>
				<Icon name="check" size={14} stroke={2.5} /> In your list
			</span>
		{:else}
			<form method="POST" action="?/add" use:enhance={onSubmit}>
				<input type="hidden" name="tmdbId" value={item.tmdbId} />
				<input type="hidden" name="mediaType" value={item.mediaType} />
				<input type="hidden" name="title" value={item.title} />
				<input type="hidden" name="posterPath" value={item.posterPath ?? ''} />
				<input type="hidden" name="releaseDate" value={item.releaseDate ?? ''} />
				<input type="hidden" name="overview" value={item.overview ?? ''} />
				<input type="hidden" name="voteAverage" value={item.voteAverage ?? ''} />
				<button
					type="submit"
					class="flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-brand text-xs font-semibold text-white shadow-sm shadow-brand/30 transition-colors duration-200 hover:bg-brand-hi active:scale-[0.98]"
				>
					<Icon name="plus" size={14} stroke={2.5} /> Save
				</button>
			</form>
		{/if}
	{/snippet}
</MediaCard>
