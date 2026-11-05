<script lang="ts">
	import ScrollRail from '#lib/components/ui/ScrollRail.svelte';
	import MediaCard from './MediaCard.svelte';
	import { mediaKey } from '#lib/domain/media.js';
	import { titlePath } from '#lib/format/title-url.js';
	import type { MediaResult } from '#lib/types.js';

	/**
	 * "More like this" on a title's page, as plain links to each title's own page.
	 *
	 * Links rather than a sheet: this page is a document, the next title deserves
	 * its own URL, and a crawler can only get from one title to another by
	 * following an `<a href>`. Renders nothing when TMDB has no suggestions.
	 */
	interface Props {
		items: MediaResult[];
	}

	let { items }: Props = $props();
</script>

{#if items.length > 0}
	<section aria-labelledby="related-heading" class="mt-8">
		<h2 id="related-heading" class="mb-3 text-sm font-bold tracking-wide text-ink-muted uppercase">
			More like this
		</h2>
		<ScrollRail label="More like this">
			{#each items as item (mediaKey(item))}
				<!-- Stays a block, so the card fills the stretched tile. See RecommendationRail. -->
				<div class="w-[9.5rem] flex-shrink-0 snap-start sm:w-[10.5rem]">
					<MediaCard
						title={item.title}
						posterPath={item.posterPath}
						releaseDate={item.releaseDate}
						voteAverage={item.voteAverage}
						mediaType={item.mediaType}
						href={titlePath(item)}
					/>
				</div>
			{/each}
		</ScrollRail>
	</section>
{/if}
