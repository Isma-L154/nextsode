<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { toasts } from '#lib/stores/toasts.svelte.js';
	import { getReleaseInfo } from '#lib/domain/release.js';
	import type { UpcomingSeason } from '#lib/types.js';

	/**
	 * Full season picker for the detail sheet.
	 *
	 * The card tracker answers "advance me by one"; this answers "I binged four
	 * seasons over the weekend" — jumping straight to a season is a single tap
	 * instead of four round-trips through the stepper.
	 *
	 * Seasons that have not aired are rendered, but disabled: hiding them would
	 * lose the information that more is coming, and enabling them would let you
	 * claim to have watched something that has not been broadcast.
	 */
	interface Props {
		itemId: string;
		title: string;
		/** Seasons that have premiered — the ceiling for what can be ticked. */
		airedSeasons: number;
		/** Including announced ones, so pending seasons can be shown greyed out. */
		totalSeasons: number;
		upcomingSeason: UpcomingSeason | null;
		seasonsSeen: number;
	}

	let { itemId, title, airedSeasons, totalSeasons, upcomingSeason, seasonsSeen }: Props = $props();

	const caughtUp = $derived(seasonsSeen >= airedSeasons);
	const nextSeason = $derived(seasonsSeen + 1);
	const moreComing = $derived(totalSeasons > airedSeasons);

	const summary = $derived(
		seasonsSeen === 0
			? 'Not started'
			: caughtUp
				? moreComing
					? 'Caught up'
					: `All ${airedSeasons} seasons watched`
				: `Season ${seasonsSeen} of ${airedSeasons}`
	);

	const release = $derived(upcomingSeason ? getReleaseInfo(upcomingSeason.airDate) : null);

	/**
	 * Feedback comes from the server's response rather than the pre-click state:
	 * the action may have discovered a newly aired season, so only it knows
	 * whether the viewer is actually caught up.
	 */
	const onSubmit: SubmitFunction = () => {
		// Captured before the await: the sheet may refetch and blank the details
		// this prop is derived from while the action is in flight.
		const label = title;
		return async ({ result, update }) => {
			await update();
			if (result.type !== 'success') {
				if (result.type !== 'redirect') toasts.add('Something went wrong', 'error');
				return;
			}
			const payload = result.data as { seasonsSeen?: number; airedSeasons?: number } | undefined;
			const seen = payload?.seasonsSeen ?? 0;
			const aired = payload?.airedSeasons ?? 0;

			if (aired && seen >= aired) toasts.add(`Caught up on “${label}” 🎉`);
			else if (seen === 0) toasts.add(`Reset progress for “${label}”`, 'info');
			else toasts.add(`Season ${seen} watched`);
		};
	};
</script>

<section
	aria-labelledby="season-progress-heading"
	class="mt-6 rounded-2xl bg-canvas/60 p-4 ring-1 ring-line"
>
	<div class="flex items-baseline justify-between gap-3">
		<h3
			id="season-progress-heading"
			class="text-[11px] font-bold tracking-widest text-ink-muted uppercase"
		>
			Season progress
		</h3>
		<span class="text-xs font-semibold {caughtUp ? 'text-mint' : 'text-ink-muted'}">{summary}</span>
	</div>

	<form method="POST" action="?/setSeasons" use:enhance={onSubmit} class="mt-3">
		<input type="hidden" name="id" value={itemId} />

		<!--
			Tapping the season you are already on steps back one, so the row doubles
			as its own undo and there is no separate "reset" control to explain.
		-->
		<div class="flex flex-wrap gap-1.5">
			{#each { length: totalSeasons }, index (index)}
				{@const season = index + 1}
				{@const aired = season <= airedSeasons}
				{@const seen = season <= seasonsSeen}
				<button
					type="submit"
					name="seasons"
					value={season === seasonsSeen ? season - 1 : season}
					disabled={!aired}
					aria-pressed={seen}
					aria-label={!aired
						? `Season ${season} of ${title} has not aired yet`
						: season === seasonsSeen
							? `Mark season ${season} of ${title} as unwatched`
							: `Mark seasons 1 to ${season} of ${title} as watched`}
					title={!aired ? 'Not aired yet' : undefined}
					class="h-9 min-w-9 rounded-lg px-2.5 text-xs font-bold tabular-nums transition-colors duration-200
						{!aired
						? 'cursor-not-allowed border border-dashed border-line bg-transparent text-ink-faint'
						: seen
							? 'cursor-pointer bg-brand text-white hover:bg-brand-hi active:scale-95'
							: 'cursor-pointer bg-surface-hi text-ink-faint ring-1 ring-line ring-inset hover:bg-line hover:text-ink active:scale-95'}"
				>
					{season}
				</button>
			{/each}
		</div>

		<!-- The single most likely next action, named explicitly so it needs no
		     interpretation of the pill row above it. -->
		{#if !caughtUp}
			<button
				type="submit"
				name="seasons"
				value={nextSeason}
				class="mt-3 flex min-h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand/15 text-sm font-semibold text-brand-hi ring-1 ring-brand/25 transition-colors duration-200 ring-inset hover:bg-brand/25"
			>
				<Icon name="play" size={14} filled />
				Watched season {nextSeason}
			</button>
		{/if}
	</form>

	<!--
		The answer to "why can't I tick season 4?", stated rather than left to be
		inferred from a disabled button.
	-->
	{#if upcomingSeason && release}
		<p class="mt-3 flex items-center gap-2 text-xs text-amber">
			<span class="relative flex h-1.5 w-1.5 flex-shrink-0">
				<span
					class="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-70"
				></span>
				<span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber"></span>
			</span>
			{#if release.state === 'upcoming'}
				Season {upcomingSeason.number} premieres {release.fullDate}
			{:else}
				Season {upcomingSeason.number} announced — no date yet
			{/if}
		</p>
	{/if}
</section>
