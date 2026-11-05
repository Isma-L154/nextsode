<script lang="ts">
	import { seriesStatus } from '#lib/domain/series-status.js';
	import type { MediaDetails } from '#lib/types.js';

	/**
	 * Whether a series is still airing, and when the next episode lands. Renders
	 * nothing for films and for series that have not premiered, which the
	 * release banner covers.
	 */
	interface Props {
		details: MediaDetails;
	}

	let { details }: Props = $props();

	const status = $derived(seriesStatus(details));
</script>

{#if status}
	<div class="mt-5 rounded-2xl bg-surface-hi/60 px-4 py-3 ring-1 ring-line">
		<p class="text-[11px] font-bold tracking-widest text-ink-muted uppercase">{status.label}</p>
		{#if status.detail}
			<p class="mt-0.5 text-sm text-ink">{status.detail}</p>
		{/if}
	</div>
{/if}
