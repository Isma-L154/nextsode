<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';
	import { creditKey, FILMOGRAPHY_SIZE } from '#lib/domain/filmography.js';
	import { posterUrl, profileUrl, releaseYear } from '#lib/format/tmdb-image.js';
	import { PersonRequest } from '#lib/stores/person.svelte.js';
	import type { CastMember, MediaResult } from '#lib/types.js';

	/**
	 * What else you have seen this actor in, opened from their face in the cast
	 * row.
	 *
	 * A panel below the row rather than a second dialog on top of the first. Two
	 * stacked sheets each listen for Escape on the window, so closing the inner
	 * one would close both, and the outer focus trap would be fighting the inner
	 * one for every Tab. Inline it is also the honest shape: this is an aside to
	 * the title being read, not a new place to be.
	 *
	 * Picking a title from here replaces the sheet rather than stacking another,
	 * which is why selection is handed all the way back up to the page.
	 */
	interface Props {
		member: CastMember;
		/** The title the sheet is open on, which the list leaves out. */
		exclude: Pick<MediaResult, 'tmdbId' | 'mediaType'>;
		onSelect: (item: MediaResult) => void;
		onClose: () => void;
	}

	let { member, exclude, onSelect, onClose }: Props = $props();

	const request = new PersonRequest();

	// Tapping a second face reuses this panel, so the fetch follows the member
	// rather than the mount.
	$effect(() => {
		void request.load(member.id);
	});

	// A late answer must not repopulate a panel that has been dismissed.
	$effect(() => () => request.cancel());

	let panel = $state<HTMLDivElement | null>(null);

	/**
	 * Bring the panel into view when it opens, and again once it has something in
	 * it.
	 *
	 * The cast row is the last thing in the sheet, so a face tapped at the bottom
	 * of the scroll opens a panel entirely below the fold — the tap appears to do
	 * nothing at all. Scrolling only on open is not enough: at that point the
	 * panel is a spinner, and the five rows that replace it push most of it back
	 * off the screen, so this runs again on whatever the request settles into.
	 *
	 * `nearest` scrolls the sheet the minimum needed rather than yanking the panel
	 * to the top and taking the face that was just tapped off the screen with it.
	 */
	$effect(() => {
		void member.id;
		void request.person;
		void request.failed;

		const el = panel;
		if (!el) return;

		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		el.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
	});

	const profile = $derived(profileUrl(member.profilePath));

	/**
	 * The sheet's own title is dropped here rather than server-side: the response
	 * is cached at the edge and shared by everyone who taps this face, while which
	 * title it was tapped from is not. One spare credit is fetched to cover it.
	 */
	const credits = $derived(
		(request.person?.credits ?? [])
			.filter((credit) => creditKey(credit) !== creditKey(exclude))
			.slice(0, FILMOGRAPHY_SIZE)
	);
</script>

<div bind:this={panel} class="mt-3 rounded-2xl bg-surface-hi/60 p-3 ring-1 ring-line">
	<div class="flex items-center gap-3">
		<div class="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-surface ring-1 ring-line">
			{#if profile}
				<img src={profile} alt="" class="h-full w-full object-cover" />
			{:else}
				<div class="flex h-full w-full items-center justify-center text-ink-faint">
					<Icon name="user" size={16} stroke={1.5} />
				</div>
			{/if}
		</div>

		<div class="min-w-0 flex-1">
			<p class="truncate text-sm font-semibold text-ink">{member.name}</p>
			<p class="truncate text-xs text-ink-faint">
				{member.character ? member.character : (request.person?.knownFor ?? 'Cast')}
			</p>
		</div>

		<button
			type="button"
			onclick={onClose}
			aria-label={`Close ${member.name}`}
			class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted transition-colors duration-200 hover:bg-line hover:text-ink"
		>
			<Icon name="close" size={16} />
		</button>
	</div>

	{#if request.loading}
		<div class="flex h-24 items-center justify-center">
			<span
				class="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand-hi"
				role="status"
				aria-label={`Loading titles for ${member.name}`}
			></span>
		</div>
	{:else if request.failed}
		<div class="flex h-24 flex-col items-center justify-center gap-2 text-center">
			<p class="text-sm text-ink-muted">Couldn't load their other titles.</p>
			<button
				type="button"
				onclick={() => request.load(member.id)}
				class="cursor-pointer rounded-lg bg-surface px-3 py-1.5 text-xs font-semibold text-ink ring-1 ring-line transition-colors duration-200 hover:bg-line"
			>
				Try again
			</button>
		</div>
	{:else if credits.length === 0}
		<!-- Real, and not a failure: TMDB has people whose only credit is the title
		     already on screen. Saying so beats an empty box. -->
		<p class="py-6 text-center text-sm text-ink-faint">
			Nothing else on record for {member.name}.
		</p>
	{:else}
		<ul class="mt-3 space-y-1">
			{#each credits as credit (credit.mediaType + credit.tmdbId)}
				{@const poster = posterUrl(credit.posterPath, 'w185')}
				{@const year = releaseYear(credit.releaseDate)}
				<li>
					<button
						type="button"
						onclick={() => onSelect(credit)}
						class="flex w-full cursor-pointer items-center gap-3 rounded-xl p-1.5 text-left transition-colors duration-200 hover:bg-line"
					>
						<div class="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-surface">
							{#if poster}
								<img src={poster} alt="" loading="lazy" class="h-full w-full object-cover" />
							{:else}
								<div class="flex h-full w-full items-center justify-center text-ink-faint">
									<Icon name="image" size={14} stroke={1.5} />
								</div>
							{/if}
						</div>

						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium text-ink">{credit.title}</p>
							<p class="flex items-center gap-1.5 truncate text-xs text-ink-faint">
								<Icon name={credit.mediaType === 'tv' ? 'tv' : 'film'} size={12} stroke={1.75} />
								{[year, credit.character].filter(Boolean).join(' · ')}
							</p>
						</div>

						<Icon name="chevronRight" size={16} class="shrink-0 text-ink-faint" />
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
