<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';
	import { backdropSrcset, backdropUrl } from '#lib/format/tmdb-image.js';
	import type { MediaDetails } from '#lib/types.js';

	/**
	 * The top of the detail sheet: artwork, or the trailer once it is asked for.
	 *
	 * The trailer replaces the backdrop rather than opening elsewhere, so the
	 * sheet keeps its shape and nothing below it moves.
	 *
	 * Separate from the heading below it because the two sit in different
	 * containers — this one spans the sheet, the heading is inset and pulled up
	 * over it.
	 */
	interface Props {
		details: MediaDetails;
	}

	let { details }: Props = $props();

	let showTrailer = $state(false);

	/**
	 * The embed's parameters, and the reason each one is here.
	 *
	 * Playback quality is deliberately absent. YouTube stopped honouring `vq`
	 * years ago and `setPlaybackQuality` is documented as a suggestion the player
	 * is free to ignore; it picks a resolution from bandwidth and viewport, and
	 * nothing an embedder passes overrides that. The viewer can still choose one
	 * by hand — the gear menu is YouTube's own and is already there.
	 *
	 * - `playsinline` keeps the trailer inside the sheet on iOS, which otherwise
	 *   throws every embed into the system fullscreen player and drops the viewer
	 *   out of the sheet they were reading.
	 * - `controls` is the default, stated so a future edit has to mean it.
	 * - `cc_load_policy` turns captions on where the video has them.
	 * - `modestbranding` and `rel` keep the end of a trailer from turning into a
	 *   grid of somebody else's uploads.
	 */
	const PLAYER_PARAMS = new URLSearchParams({
		autoplay: '1',
		playsinline: '1',
		controls: '1',
		cc_load_policy: '1',
		modestbranding: '1',
		rel: '0'
	}).toString();

	// A new title means a new sheet, but the same sheet can refetch when the
	// tracked season changes; the trailer should not survive that.
	$effect(() => {
		void details.tmdbId;
		showTrailer = false;
	});

	const backdrop = $derived(backdropUrl(details.backdropPath));
	const backdropSet = $derived(backdropSrcset(details.backdropPath));
</script>

<div class="relative aspect-video w-full overflow-hidden bg-surface-hi">
	{#if showTrailer && details.trailerKey}
		<iframe
			class="h-full w-full"
			title={`${details.title} trailer`}
			src={`https://www.youtube-nocookie.com/embed/${details.trailerKey}?${PLAYER_PARAMS}`}
			allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
			allowfullscreen
		></iframe>
	{:else}
		{#if backdrop}
			<!--
				`sizes` describes the rendered width, not the file: the sheet is capped
				at 672px on a pointer device and spans the viewport on a phone. The
				browser multiplies that by the device pixel ratio itself, which is the
				part a fixed width can never get right for both.
			-->
			<img
				src={backdrop}
				srcset={backdropSet}
				sizes="(min-width: 640px) 672px, 100vw"
				alt=""
				class="h-full w-full object-cover"
			/>
		{/if}
		<div class="absolute inset-0 bg-gradient-to-t from-surface via-surface/45 to-transparent"></div>
		{#if details.trailerKey}
			<button
				type="button"
				onclick={() => (showTrailer = true)}
				class="absolute inset-0 flex cursor-pointer items-center justify-center"
				aria-label={`Play the ${details.title} trailer`}
			>
				<span
					class="flex items-center gap-2 rounded-full bg-white/15 px-5 py-3 font-semibold text-white ring-1 ring-white/25 backdrop-blur transition-colors duration-200 hover:bg-white/25"
				>
					<Icon name="play" size={16} filled /> Play trailer
				</span>
			</button>
		{/if}
	{/if}
</div>
