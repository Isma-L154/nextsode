<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PosterGrid from './PosterGrid.svelte';
	import WatchlistCard from './WatchlistCard.svelte';
	import { groupByUpcomingWindow } from '$lib/domain/upcoming';
	import { releaseVerb } from '$lib/domain/release';
	import type { WatchlistItem } from '$lib/server/db/schema';

	/**
	 * Everything still to come, bucketed by how soon.
	 *
	 * A flat grid sorted by date carries the same facts, but reading it means
	 * comparing every badge against today. Headings answer the question directly:
	 * "is there anything this week?" is one glance, not arithmetic.
	 *
	 * Both kinds of pending thing live here — a film that has not opened and a
	 * season that has not premiered — because from the viewer's side they are the
	 * same event: something they are waiting for.
	 */
	interface Props {
		items: WatchlistItem[];
		eagerPosters: number;
		onSelect: (item: WatchlistItem) => void;
		onToggle: (item: WatchlistItem) => SubmitFunction;
		onSetSeasons: (item: WatchlistItem) => SubmitFunction;
		onRemove: (item: WatchlistItem) => SubmitFunction;
	}

	let { items, eagerPosters, onSelect, onToggle, onSetSeasons, onRemove }: Props = $props();

	const groups = $derived(groupByUpcomingWindow(items));

	/**
	 * Poster priority is counted across the whole view, not per group: the browser
	 * does not care which heading a tile sits under, only how many images are
	 * competing for bandwidth before the largest one paints.
	 */
	function eagerUpTo(groupIndex: number, indexInGroup: number): boolean {
		let seen = indexInGroup;
		for (let i = 0; i < groupIndex; i++) seen += groups[i].items.length;
		return seen < eagerPosters;
	}
</script>

<div class="space-y-8">
	{#each groups as group, groupIndex (group.window)}
		<section aria-labelledby={`coming-${group.window}`}>
			<div class="mb-3 flex items-center gap-2">
				<Icon
					name={group.window === 'undated' ? 'clock' : 'calendar'}
					size={15}
					class="text-amber"
				/>
				<h3
					id={`coming-${group.window}`}
					class="text-sm font-bold tracking-wide text-ink uppercase"
				>
					{group.label}
				</h3>
				<span class="text-xs text-ink-faint">{group.items.length}</span>
			</div>

			<PosterGrid>
				{#each group.items as { item, upcoming }, index (item.id)}
					<div>
						<WatchlistCard
							{item}
							priority={eagerUpTo(groupIndex, index)}
							onSelect={() => onSelect(item)}
							onToggle={onToggle(item)}
							onSetSeasons={onSetSeasons(item)}
							onRemove={onRemove(item)}
						/>
						<!--
							The card badge already carries the short date. This line names the
							*event*, which the badge cannot: "Oct 15" alone does not say
							whether a film opens or a fourth season starts.
						-->
						<p class="mt-1.5 px-1 text-[11px] text-ink-faint">
							{#if upcoming.kind === 'season'}
								Season {upcoming.seasonNumber}
							{:else}
								<!--
									A film opens and a series premieres, and this line used to
									call both of them a premiere. It matters more now that the
									card directly above names the same event in its own words:
									"Out Sep 9" over "Premieres · Wednesday, September 9" is the
									card disagreeing with its own caption.
								-->
								{releaseVerb(item.mediaType)}
							{/if}
							· {upcoming.date ? upcoming.fullDate : 'date not announced'}
						</p>
					</div>
				{/each}
			</PosterGrid>
		</section>
	{/each}
</div>
