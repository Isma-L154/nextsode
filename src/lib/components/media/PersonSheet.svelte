<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';
	import ModalSheet from '#lib/components/ui/ModalSheet.svelte';
	import PosterGrid from './PosterGrid.svelte';
	import MediaCard from './MediaCard.svelte';
	import { profileUrl, releaseYear } from '#lib/format/tmdb-image.js';
	import { PersonRequest } from '#lib/stores/person.svelte.js';
	import type { MediaResult, PersonResult } from '#lib/types.js';

	/**
	 * One person's work, opened from a name search.
	 *
	 * The sheet a face in the People row leads to, and the browsable half of
	 * searching by actor: the row answers "which one is this", this answers "what
	 * have they been in".
	 *
	 * A grid rather than the five-row list a detail sheet shows, because nothing
	 * else is competing for the space here — this sheet is only ever about the
	 * person, so the whole ranked filmography fits.
	 */
	interface Props {
		person: PersonResult;
		/** Picking a title closes this sheet and opens that title's. */
		onSelect: (item: MediaResult) => void;
		onClose: () => void;
	}

	let { person, onSelect, onClose }: Props = $props();

	const request = new PersonRequest();

	$effect(() => {
		void request.load(person.id);
	});

	const profile = $derived(profileUrl(person.profilePath));
	const credits = $derived(request.person?.credits ?? []);

	/**
	 * The header falls back to the search result while the request is in flight.
	 *
	 * The name and photograph are already known — they are what was tapped — so
	 * showing a spinner where the person's name goes would hide information the
	 * page has had all along.
	 */
	const knownFor = $derived(request.person?.knownFor ?? person.knownFor);

	/**
	 * Year and role on one line.
	 *
	 * The card's note replaces its year rather than sitting beside it, and both
	 * belong here — the role is what makes a credit theirs, the year is what
	 * places it in a career.
	 */
	function credited(credit: { releaseDate: string | null; character: string | null }): string {
		return [releaseYear(credit.releaseDate), credit.character].filter(Boolean).join(' · ');
	}
</script>

<ModalSheet label={person.name} {onClose}>
	<div class="px-4 pt-6 pb-8 sm:px-6">
		<div class="flex items-center gap-4">
			<div
				class="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-surface-hi ring-1 ring-line sm:h-24 sm:w-24"
			>
				{#if profile}
					<img src={profile} alt="" class="h-full w-full object-cover" />
				{:else}
					<div class="flex h-full w-full items-center justify-center text-ink-faint">
						<Icon name="user" size={30} stroke={1.5} />
					</div>
				{/if}
			</div>

			<div class="min-w-0">
				<h2 class="font-display text-xl font-extrabold text-ink sm:text-2xl">{person.name}</h2>
				{#if knownFor}
					<p class="mt-0.5 text-sm text-ink-muted">{knownFor}</p>
				{/if}
			</div>
		</div>

		{#if request.loading}
			<div class="flex h-48 items-center justify-center">
				<span
					class="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand-hi"
					role="status"
					aria-label={`Loading titles for ${person.name}`}
				></span>
			</div>
		{:else if request.failed}
			<div class="flex h-48 flex-col items-center justify-center gap-3 text-center">
				<Icon name="alert" size={26} class="text-ink-faint" />
				<p class="text-ink-muted">Couldn't load their titles.</p>
				<button
					type="button"
					onclick={() => request.load(person.id)}
					class="cursor-pointer rounded-lg bg-surface-hi px-4 py-2 text-sm font-semibold text-ink ring-1 ring-line transition-colors duration-200 hover:bg-line"
				>
					Try again
				</button>
			</div>
		{:else if credits.length === 0}
			<p class="py-16 text-center text-ink-faint">Nothing on record for {person.name}.</p>
		{:else}
			<h3 class="mt-7 mb-3 text-sm font-bold tracking-wide text-ink-muted uppercase">Known for</h3>
			<!--
				Bare `MediaCard`s rather than `DiscoverCard`s: no save control here.
				Picking a title opens its own sheet, which is where saving already
				lives, and duplicating the form would mean this sheet had to know the
				viewer's whole saved list to avoid offering to add something twice.
			-->
			<PosterGrid>
				{#each credits as credit (credit.mediaType + credit.tmdbId)}
					<MediaCard
						title={credit.title}
						posterPath={credit.posterPath}
						releaseDate={credit.releaseDate}
						voteAverage={credit.voteAverage}
						mediaType={credit.mediaType}
						note={credited(credit) || undefined}
						onSelect={() => onSelect(credit)}
					/>
				{/each}
			</PosterGrid>
		{/if}
	</div>
</ModalSheet>
