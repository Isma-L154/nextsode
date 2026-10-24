<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';
	import ScrollRail from '#lib/components/ui/ScrollRail.svelte';
	import FilmographyPanel from './FilmographyPanel.svelte';
	import { profileUrl } from '#lib/format/tmdb-image.js';
	import type { CastMember, MediaResult } from '#lib/types.js';

	/**
	 * Faces, for the "where do I know them from" question a synopsis never
	 * answers. Renders nothing when TMDB has no cast.
	 *
	 * A `ScrollRail` rather than a bare overflow container: a full billed cast
	 * runs well past the width of the sheet, and with the scrollbar hidden a
	 * mouse had no way to reach past the fourth or fifth face.
	 *
	 * Each face now answers the question rather than just posing it — tapping one
	 * opens their other work below the row.
	 */
	interface Props {
		cast: CastMember[];
		/** The title this row belongs to, so a filmography can leave it out. */
		title: Pick<MediaResult, 'tmdbId' | 'mediaType'>;
		/** Opening a title from a filmography swaps the sheet to that title. */
		onSelectTitle: (item: MediaResult) => void;
	}

	let { cast, title, onSelectTitle }: Props = $props();

	/** The face whose filmography is open, by TMDB person id. */
	let openPerson = $state<number | null>(null);

	const active = $derived(cast.find((member) => member.id === openPerson) ?? null);

	// A different title means a different cast; leaving the panel open would show
	// one film's actor under another film's poster.
	$effect(() => {
		void cast;
		openPerson = null;
	});

	/** Tapping the open face closes it again, which is what a toggle should do. */
	function toggle(member: CastMember) {
		openPerson = openPerson === member.id ? null : member.id;
	}
</script>

{#if cast.length}
	<h3 class="mt-7 text-sm font-bold tracking-wide text-ink-muted uppercase">Cast</h3>
	<div class="mt-1">
		<ScrollRail label="Cast">
			{#each cast as person (person.id + '|' + person.character)}
				{@const profile = profileUrl(person.profilePath)}
				{@const open = openPerson === person.id}
				<button
					type="button"
					onclick={() => toggle(person)}
					aria-expanded={open}
					aria-label={`Other titles with ${person.name}`}
					class="w-20 flex-shrink-0 cursor-pointer snap-start rounded-xl text-center"
				>
					<div
						class="mx-auto h-20 w-20 overflow-hidden rounded-full bg-surface-hi ring-1 transition-[box-shadow,color] duration-200 {open
							? 'ring-2 ring-brand-hi'
							: 'ring-line hover:ring-ink-faint'}"
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
								<Icon name="user" size={22} stroke={1.5} />
							</div>
						{/if}
					</div>
					<p class="mt-1.5 line-clamp-2 text-[11px] font-medium text-ink">{person.name}</p>
					{#if person.character}
						<p class="line-clamp-1 text-[10px] text-ink-faint">{person.character}</p>
					{/if}
				</button>
			{/each}
		</ScrollRail>
	</div>

	{#if active}
		<FilmographyPanel
			member={active}
			exclude={title}
			onSelect={onSelectTitle}
			onClose={() => (openPerson = null)}
		/>
	{/if}
{/if}
