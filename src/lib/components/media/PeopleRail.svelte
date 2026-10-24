<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';
	import ScrollRail from '#lib/components/ui/ScrollRail.svelte';
	import { profileUrl } from '#lib/format/tmdb-image.js';
	import type { PersonResult } from '#lib/types.js';

	/**
	 * The people a search matched, above the titles it matched.
	 *
	 * Searching by name used to return whatever happened to share the word with a
	 * film — type "Cillian Murphy" and you got nothing, because the app only ever
	 * looked at titles. This row is the other half of the question, and it sits
	 * above the results rather than mixed into them: a face and a poster are
	 * different shapes, and a grid that alternates between them reads as a bug.
	 *
	 * Each face names a couple of things they are known for, which is what tells
	 * two actors with the same name apart before you tap either.
	 */
	interface Props {
		people: PersonResult[];
		onSelect: (person: PersonResult) => void;
	}

	let { people, onSelect }: Props = $props();
</script>

{#if people.length}
	<section aria-labelledby="search-people" class="mb-6">
		<div class="mb-2 flex items-center gap-2">
			<Icon name="user" size={15} class="text-ink-faint" />
			<h2 id="search-people" class="text-sm font-bold tracking-wide text-ink-muted uppercase">
				People
			</h2>
			<span class="text-xs text-ink-faint">{people.length}</span>
		</div>

		<ScrollRail label="People">
			{#each people as person (person.id)}
				{@const profile = profileUrl(person.profilePath)}
				<button
					type="button"
					onclick={() => onSelect(person)}
					aria-label={`Titles with ${person.name}`}
					class="w-24 flex-shrink-0 cursor-pointer snap-start rounded-xl text-center"
				>
					<div
						class="mx-auto h-24 w-24 overflow-hidden rounded-full bg-surface-hi ring-1 ring-line transition-shadow duration-200 hover:ring-2 hover:ring-brand-hi"
					>
						{#if profile}
							<img
								src={profile}
								alt={person.name}
								loading="lazy"
								class="h-full w-full object-cover"
							/>
						{:else}
							<div class="flex h-full w-full items-center justify-center text-ink-faint">
								<Icon name="user" size={26} stroke={1.5} />
							</div>
						{/if}
					</div>
					<p class="mt-1.5 line-clamp-2 text-xs font-semibold text-ink">{person.name}</p>
					{#if person.knownForTitles.length}
						<p class="line-clamp-2 text-[10px] text-ink-faint">
							{person.knownForTitles.join(', ')}
						</p>
					{:else if person.knownFor}
						<p class="line-clamp-1 text-[10px] text-ink-faint">{person.knownFor}</p>
					{/if}
				</button>
			{/each}
		</ScrollRail>
	</section>
{/if}
