<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import ModalSheet from '$lib/components/ui/ModalSheet.svelte';
	import TitleDetail from './TitleDetail.svelte';
	import SeasonPicker from './SeasonPicker.svelte';
	import EpisodePicker from './EpisodePicker.svelte';
	import SaveControl from './SaveControl.svelte';
	import ShareButton from './ShareButton.svelte';
	import { getEpisodePosition } from '$lib/domain/episodes';
	import { titlePath } from '$lib/format/title-url';
	import { MediaDetailsRequest } from '$lib/stores/details.svelte';
	import type { MediaResult, MediaType, SavedEntry } from '$lib/types';

	/**
	 * Everything known about one title, and the things you can do to it.
	 *
	 * This file is composition and nothing else. The fetch lives in a store, the
	 * dialog behaviour in `ModalSheet`, the running order of the content in
	 * `TitleDetail` — which the title's public page renders too — and what is left
	 * here is what only the sheet has: progress controls, and the account actions
	 * underneath.
	 */
	interface Props {
		tmdbId: number;
		mediaType: MediaType;
		/** The saved row when this title is already on the list, otherwise null. */
		saved: SavedEntry | null;
		/** Saving requires an account; signed-out visitors get a sign-in prompt. */
		signedIn: boolean;
		/** ISO country for streaming availability, resolved at the edge. */
		country: string;
		/**
		 * Absolute origin, so the share link is the one that will be pasted rather
		 * than a path only this tab can resolve.
		 */
		origin: string;
		/**
		 * Follow a link out of this sheet into another title's — currently only
		 * from a cast member's filmography.
		 *
		 * Handed up to the page rather than handled here, because the page owns
		 * which title is open. Swapping it there reuses this one sheet; doing it
		 * internally would leave the page's own selection stale, and stacking a
		 * second sheet would put two focus traps and two Escape handlers on the
		 * same window.
		 */
		onSelectTitle: (item: MediaResult) => void;
		onClose: () => void;
	}

	let { tmdbId, mediaType, saved, signedIn, country, origin, onSelectTitle, onClose }: Props =
		$props();

	const request = new MediaDetailsRequest();

	/**
	 * Which season's episodes to request: the one in progress. Derived from the
	 * saved row rather than from the response, so the ask can be made in the same
	 * round-trip that fetches the details themselves.
	 */
	const position = $derived(
		saved && mediaType === 'tv'
			? getEpisodePosition({ mediaType, ...saved, episodesIntoSeason: saved.episodesIntoSeason })
			: null
	);

	const query = $derived({
		tmdbId,
		mediaType,
		country,
		season: position?.trackable ? position.season : null
	});

	// Refetch whenever the title, or the season being tracked, changes.
	$effect(() => {
		void request.load(query);
	});

	const details = $derived(request.details);

	const shareUrl = $derived(details ? `${origin}${titlePath(details)}` : null);
</script>

<ModalSheet label={details?.title ?? 'Title details'} {onClose}>
	{#if request.loading}
		<div class="flex h-72 items-center justify-center">
			<span
				class="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand-hi"
				role="status"
				aria-label="Loading details"
			></span>
		</div>
	{:else if request.failed || !details}
		<div class="flex h-72 flex-col items-center justify-center gap-3 px-6 text-center">
			<Icon name="alert" size={28} class="text-ink-faint" />
			<p class="text-ink-muted">Couldn't load details.</p>
			<button
				type="button"
				onclick={() => request.load(query)}
				class="cursor-pointer rounded-lg bg-surface-hi px-4 py-2 text-sm font-semibold text-ink ring-1 ring-line transition-colors duration-200 hover:bg-line"
			>
				Try again
			</button>
		</div>
	{:else}
		<TitleDetail {details} {onSelectTitle}>
			{#snippet progress()}
				{#if saved && details.mediaType === 'tv' && details.airedSeasons && details.airedSeasons > 1}
					<SeasonPicker
						itemId={saved.id}
						title={details.title}
						airedSeasons={details.airedSeasons}
						totalSeasons={details.seasons ?? details.airedSeasons}
						upcomingSeason={details.upcomingSeason}
						seasonsSeen={saved.watched ? details.airedSeasons : saved.seasonsSeen}
					/>
				{/if}

				<!-- The season picker says which season; this says where inside it. -->
				{#if saved && position?.trackable && details.season}
					<EpisodePicker
						itemId={saved.id}
						title={details.title}
						season={details.season}
						episodesWatched={position.episodesWatched}
					/>
				{/if}
			{/snippet}

			{#snippet actions()}
				<SaveControl {details} {saved} {signedIn} />
				{#if shareUrl}
					<ShareButton url={shareUrl} title={details.title} />
				{/if}
			{/snippet}
		</TitleDetail>
	{/if}
</ModalSheet>
