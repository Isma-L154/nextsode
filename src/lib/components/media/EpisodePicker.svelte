<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { formatRuntime } from '$lib/format/tmdb-image';
	import type { SeasonEpisodes } from '$lib/types';

	/**
	 * The episode list of the season in progress.
	 *
	 * Tapping an episode sets the bookmark to "watched through here", so jumping
	 * after a weekend binge is one tap rather than eight. Episodes that have not
	 * aired are rendered and disabled — the same treatment unaired seasons get,
	 * because hiding them would lose the information that more is coming.
	 */
	interface Props {
		itemId: string;
		title: string;
		season: SeasonEpisodes;
		/** Episodes of this season already watched. */
		episodesWatched: number;
	}

	let { itemId, title, season, episodesWatched }: Props = $props();

	/**
	 * The title is captured here, before the await.
	 *
	 * Completing a season moves the bookmark into the next one, which makes the
	 * sheet refetch and blank `details` — so by the time this resumes, the prop
	 * derived from it is gone. The message is about what just happened, so the
	 * value at submit time is the right one to use anyway.
	 */
	const onSubmit: SubmitFunction = () => {
		const label = title;
		return async ({ result, update }) => {
			await update();
			if (result.type !== 'success') {
				const message =
					result.type === 'failure'
						? ((result.data as { message?: string } | undefined)?.message ?? 'Something went wrong')
						: 'Something went wrong';
				if (result.type !== 'redirect') toasts.add(message, 'error');
				return;
			}
			const payload = result.data as
				{ season?: number; episodesWatched?: number; seasonComplete?: boolean } | undefined;

			if (payload?.seasonComplete) toasts.add(`Finished season ${payload.season} of “${label}”`);
			else if (!payload?.episodesWatched) toasts.add(`Back to the start of “${label}”`, 'info');
			else toasts.add(`Up to S${payload.season}E${payload.episodesWatched}`);
		};
	};
</script>

<section
	aria-labelledby="episode-heading"
	class="mt-4 rounded-2xl bg-canvas/60 p-4 ring-1 ring-line"
>
	<div class="flex items-baseline justify-between gap-3">
		<h3 id="episode-heading" class="text-[11px] font-bold tracking-widest text-ink-muted uppercase">
			Season {season.seasonNumber} episodes
		</h3>
		<span class="text-xs font-semibold text-ink-muted">
			{episodesWatched}/{season.airedCount} watched
		</span>
	</div>

	<form method="POST" action="?/setEpisode" use:enhance={onSubmit} class="mt-3 space-y-1">
		<input type="hidden" name="id" value={itemId} />
		<input type="hidden" name="season" value={season.seasonNumber} />

		{#each season.episodes as episode (episode.number)}
			{@const seen = episode.number <= episodesWatched}
			<button
				type="submit"
				name="episode"
				disabled={!episode.aired}
				aria-pressed={seen}
				aria-label={!episode.aired
					? `Episode ${episode.number}, ${episode.name}, has not aired yet`
					: seen
						? `Rewind to before episode ${episode.number}`
						: `Mark watched through episode ${episode.number}, ${episode.name}`}
				value={episode.number === episodesWatched ? episode.number - 1 : episode.number}
				class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-200
					{!episode.aired
					? 'cursor-not-allowed opacity-45'
					: seen
						? 'cursor-pointer bg-brand/12 hover:bg-brand/20'
						: 'cursor-pointer hover:bg-surface-hi'}"
			>
				<span
					class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums
						{seen ? 'bg-brand text-white' : 'bg-surface-hi text-ink-faint ring-1 ring-line ring-inset'}"
				>
					{#if seen}
						<Icon name="check" size={12} stroke={3} />
					{:else}
						{episode.number}
					{/if}
				</span>

				<span class="min-w-0 flex-1">
					<span class="block truncate text-xs font-medium {seen ? 'text-ink' : 'text-ink-muted'}">
						{episode.name}
					</span>
					{#if !episode.aired}
						<span class="block text-[10px] text-amber">
							{episode.airDate ? `Airs ${episode.airDate}` : 'No date yet'}
						</span>
					{/if}
				</span>

				{#if episode.runtimeMinutes}
					<span class="flex-shrink-0 text-[10px] text-ink-faint tabular-nums">
						{formatRuntime(episode.runtimeMinutes)}
					</span>
				{/if}
			</button>
		{/each}
	</form>

	<p class="mt-2 px-2 text-[10px] text-ink-faint">
		Tap an episode to mark everything up to it as watched. Tap the one you are on to step back.
	</p>
</section>
