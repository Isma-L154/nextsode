<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import Icon from '$lib/components/ui/Icon.svelte';
	import SeasonProgressBar from './SeasonProgressBar.svelte';
	import type { SeasonProgress } from '$lib/domain/progress';

	/**
	 * Season progress control for a saved show.
	 *
	 * The previous version was a −/+ counter, which asked the user to work out
	 * what the number *meant* before acting on it. This leads with the decision
	 * instead: one wide primary button that names the next season, with the
	 * step-back tucked beside it as the secondary escape hatch.
	 *
	 * Every button submits an *absolute* target season rather than a delta, so a
	 * double-tap or a replayed request is idempotent — the server writes the same
	 * number twice instead of drifting the count.
	 */
	interface Props {
		itemId: string;
		title: string;
		progress: SeasonProgress;
		onSubmit: SubmitFunction;
		/** `card` is the compact footer variant; `rail` is roomier. */
		variant?: 'card' | 'rail';
	}

	let { itemId, title, progress, onSubmit, variant = 'card' }: Props = $props();

	/**
	 * "Caught up" and "complete" both mean there is nothing left to watch right
	 * now, so they share the finished styling — but only `complete` means the
	 * show is over. The distinction is carried by the label.
	 */
	const done = $derived(progress.state === 'caughtUp' || progress.state === 'complete');
	const nextSeason = $derived(progress.seasonsSeen + 1);

	// A finished show still needs a way back, so the primary slot flips to
	// "rewatch the last season" rather than disappearing.
	const primaryTarget = $derived(done ? progress.airedSeasons - 1 : nextSeason);
	const primaryLabel = $derived(done ? 'Rewatch' : `Watch S${nextSeason}`);
	const primaryDescription = $derived(
		done
			? `Mark the last watched season of ${title} as unwatched`
			: `Mark season ${nextSeason} of ${title} as watched`
	);
</script>

<div class="space-y-2">
	<div class="flex items-center gap-2">
		<SeasonProgressBar {progress} size={variant === 'rail' ? 'md' : 'sm'} />

		<!-- `progress.label` is the full sentence ("Season 3 of 5"); the visible text
		     is the compact form, and the title carries the long one for anyone who
		     needs it. -->
		<span
			title={progress.label}
			class="flex-shrink-0 text-[11px] font-semibold tabular-nums {done
				? 'text-mint'
				: 'text-ink-muted'}"
		>
			{progress.seasonsSeen}/{progress.airedSeasons}
		</span>
	</div>

	<form
		method="POST"
		action="?/setSeasons"
		use:enhance={onSubmit}
		class="flex items-center gap-1.5"
	>
		<input type="hidden" name="id" value={itemId} />

		<button
			type="submit"
			name="seasons"
			value={primaryTarget}
			title={primaryDescription}
			aria-label={primaryDescription}
			class="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold transition-colors duration-200 active:scale-[0.98]
				{done
				? 'bg-mint/15 text-mint hover:bg-mint/25'
				: 'bg-brand text-white shadow-sm shadow-brand/30 hover:bg-brand-hi'}"
		>
			<Icon name={done ? 'rotate' : 'play'} size={14} filled={!done} />
			<span class="truncate">{primaryLabel}</span>
		</button>

		<!-- Step back one season. Hidden at the start, where it would be a
		     permanently disabled control taking up a third of the row. -->
		{#if progress.seasonsSeen > 0 && !done}
			<button
				type="submit"
				name="seasons"
				value={progress.seasonsSeen - 1}
				aria-label={`Mark season ${progress.seasonsSeen} of ${title} as unwatched`}
				class="flex h-[38px] w-9 flex-shrink-0 items-center justify-center rounded-xl bg-surface-hi text-ink-muted ring-1 ring-line transition-colors duration-200 ring-inset hover:bg-line hover:text-ink"
			>
				<Icon name="minus" size={14} />
			</button>
		{/if}
	</form>
</div>
