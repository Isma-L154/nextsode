<script lang="ts">
	import type { SeasonProgress } from '#lib/domain/progress.js';

	/**
	 * Season progress as a segmented bar — one segment per season.
	 *
	 * Segments beat a continuous fill here because the underlying quantity is
	 * discrete: "3 of 5" is countable at a glance, whereas a 60%-filled bar has to
	 * be read off a label to mean anything. Past a dozen seasons the segments get
	 * thinner than the gaps between them, so it degrades to a plain bar rather
	 * than showing a row of slivers.
	 */
	interface Props {
		progress: SeasonProgress;
		/** `sm` for card footers, `md` for the Continue Watching rail. */
		size?: 'sm' | 'md';
	}

	let { progress, size = 'sm' }: Props = $props();

	const MAX_SEGMENTS = 12;

	// Segments track what can be watched, not what has been announced — an
	// unaired season is not a slot you can fill in.
	const segmented = $derived(progress.airedSeasons <= MAX_SEGMENTS);
	const done = $derived(progress.state === 'caughtUp' || progress.state === 'complete');
	const height = $derived(size === 'sm' ? 'h-1' : 'h-1.5');
	const fill = $derived(done ? 'bg-mint' : 'bg-sky');
</script>

<!--
	The bar is decorative: `progress.label` ("Season 3 of 5") is always rendered
	next to it by the caller, so assistive tech gets the number as text instead of
	a role="progressbar" whose value it would have to announce as a percentage.
-->
<div class="flex w-full items-center gap-[3px]" aria-hidden="true">
	{#if segmented}
		{#each { length: progress.airedSeasons }, index (index)}
			<span
				class="{height} flex-1 rounded-full transition-colors duration-300
					{index < progress.seasonsSeen ? fill : 'bg-line'}"
			></span>
		{/each}
	{:else}
		<span class="{height} w-full overflow-hidden rounded-full bg-line">
			<span
				class="block h-full rounded-full {fill} transition-[width] duration-300"
				style:width="{progress.percent}%"
			></span>
		</span>
	{/if}
</div>
