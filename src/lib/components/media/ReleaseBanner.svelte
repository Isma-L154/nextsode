<script lang="ts">
	import { getReleaseInfo, releaseVerb } from '#lib/domain/release.js';
	import type { MediaDetails } from '#lib/types.js';

	/**
	 * "Not out yet", stated rather than left to be inferred.
	 *
	 * TMDB indexes titles long before they exist, so a sheet can look complete —
	 * poster, cast, synopsis — for something nobody can watch. Renders nothing at
	 * all once the title is released.
	 */
	interface Props {
		details: MediaDetails;
	}

	let { details }: Props = $props();

	const release = $derived(getReleaseInfo(details.releaseDate));

	/**
	 * Countdown wording, kept apart from the date so the banner reads as "when"
	 * followed by "how soon" rather than repeating itself.
	 */
	const countdown = $derived.by(() => {
		const days = release.daysUntil;
		if (!days) return '';
		if (days === 1) return 'tomorrow';
		if (days < 30) return `in ${days} days`;
		const months = Math.round(days / 30);
		if (months < 12) return `in about ${months} month${months > 1 ? 's' : ''}`;
		const years = Math.round(days / 365);
		return `in about ${years} year${years > 1 ? 's' : ''}`;
	});

	const status = $derived(details.productionStatus?.toLowerCase() ?? '');
</script>

{#if release.state !== 'released'}
	<div
		class="mt-5 flex items-start gap-3 rounded-2xl border border-amber/20 bg-amber/[0.06] px-4 py-3"
	>
		<span class="relative mt-1.5 flex h-2 w-2 flex-shrink-0">
			<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-70"
			></span>
			<span class="relative inline-flex h-2 w-2 rounded-full bg-amber"></span>
		</span>
		<div class="min-w-0">
			<p class="text-[11px] font-bold tracking-widest text-amber uppercase">Not out yet</p>
			{#if release.state === 'upcoming'}
				<p class="mt-0.5 text-sm text-ink">
					{releaseVerb(details.mediaType)}
					{release.fullDate}
				</p>
				<p class="mt-0.5 text-xs text-amber/75">
					{countdown}{status ? ` · ${status}` : ''}
				</p>
			{:else}
				<p class="mt-0.5 text-sm text-ink">No release date announced yet.</p>
				{#if status}
					<p class="mt-0.5 text-xs text-amber/75">Currently {status}</p>
				{/if}
			{/if}
		</div>
	</div>
{/if}
