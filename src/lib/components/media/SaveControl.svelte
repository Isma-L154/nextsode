<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '#lib/components/ui/Icon.svelte';
	import GoogleButton from '#lib/components/auth/GoogleButton.svelte';
	import { withToast } from '#lib/forms/feedback.js';
	import { JUST_SAVED, optimistic, pendingSaves } from '#lib/stores/pending-saves.svelte.js';
	import { mediaKey } from '#lib/domain/media.js';
	import type { MediaDetails, SavedEntry } from '#lib/types.js';

	/**
	 * The one action the sheet exists to offer, in whichever of its three states
	 * applies. They are mutually exclusive on purpose: the footer never shows a
	 * control that cannot succeed.
	 *
	 * The whole snapshot is posted rather than an id alone, so the list renders
	 * from its own row and never needs TMDB to draw a card.
	 */
	interface Props {
		details: MediaDetails;
		/** The saved row when this title is already on the list, otherwise null. */
		saved: SavedEntry | null;
		signedIn: boolean;
	}

	let { details, saved, signedIn }: Props = $props();

	const key = $derived(mediaKey(details));

	/**
	 * True from the tap until the server answers, and why both buttons below can
	 * be disabled while still reading as the thing that just happened.
	 *
	 * This is not politeness about double taps. The control has already swapped
	 * to the opposite action, and that action cannot succeed yet: `remove` posts
	 * the row id, and an optimistic save has no id to post until the server has
	 * made the row. So the button says what is true and refuses to be pressed,
	 * rather than offering a write that would come back a 400.
	 */
	const busy = $derived(pendingSaves.pending(key));
</script>

<div class="mt-6">
	{#if !signedIn}
		<GoogleButton size="full" label="Sign in to save this" />
	{:else if saved}
		<form
			method="POST"
			action="?/remove"
			use:enhance={optimistic(key, null, withToast(`Removed “${details.title}”`, 'info'))}
		>
			<input type="hidden" name="id" value={saved.id} />
			<button
				type="submit"
				disabled={busy}
				aria-busy={busy}
				class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-rose/12 py-3 text-sm font-semibold text-rose transition-colors duration-200 hover:bg-rose/22 disabled:cursor-not-allowed disabled:opacity-60"
			>
				<Icon name="trash" size={16} /> Remove from my list
			</button>
		</form>
	{:else}
		<form
			method="POST"
			action="?/add"
			use:enhance={optimistic(key, JUST_SAVED, withToast(`Added “${details.title}”`))}
		>
			<input type="hidden" name="tmdbId" value={details.tmdbId} />
			<input type="hidden" name="mediaType" value={details.mediaType} />
			<input type="hidden" name="title" value={details.title} />
			<input type="hidden" name="posterPath" value={details.posterPath ?? ''} />
			<input type="hidden" name="releaseDate" value={details.releaseDate ?? ''} />
			<input type="hidden" name="overview" value={details.overview ?? ''} />
			<input type="hidden" name="voteAverage" value={details.voteAverage ?? ''} />
			<button
				type="submit"
				disabled={busy}
				aria-busy={busy}
				class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-semibold text-white shadow-sm shadow-brand/30 transition-colors duration-200 hover:bg-brand-hi disabled:cursor-not-allowed disabled:opacity-60"
			>
				<Icon name="plus" size={16} stroke={2.5} /> Save to my list
			</button>
		</form>
	{/if}
</div>
