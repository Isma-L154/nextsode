<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Icon from '$lib/components/ui/Icon.svelte';
	import SearchBar from '$lib/components/ui/SearchBar.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import PosterGrid from '$lib/components/media/PosterGrid.svelte';
	import PosterGridSkeleton from '$lib/components/media/PosterGridSkeleton.svelte';
	import DiscoverCard from '$lib/components/media/DiscoverCard.svelte';
	import RecommendationRail from '$lib/components/media/RecommendationRail.svelte';
	import MediaDetailModal from '$lib/components/media/MediaDetailModal.svelte';
	import PeopleRail from '$lib/components/media/PeopleRail.svelte';
	import PersonSheet from '$lib/components/media/PersonSheet.svelte';
	import GoogleButton from '$lib/components/auth/GoogleButton.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import { siteSchema } from '$lib/format/seo';
	import { parseTitleParam } from '$lib/domain/calendar';
	import { MediaSearch } from '$lib/stores/search.svelte';
	import { homeReset } from '$lib/stores/home-reset.svelte';
	import { JUST_SAVED, optimistic, pendingSaves } from '$lib/stores/pending-saves.svelte';
	import { TrendingFeed } from '$lib/stores/trending.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { withToast } from '$lib/forms/feedback';
	import { dedupeByKey, mediaKey } from '$lib/domain/media';
	import type { MediaResult, MediaType, PersonResult } from '$lib/types';
	import type { PageData } from './$types';

	/**
	 * Discover — finding something to watch.
	 *
	 * This page used to also carry the watchlist, stacked underneath trending and
	 * search results. That put the list one full scroll below the fold on every
	 * visit, which is the wrong end of the app to bury: browsing is occasional,
	 * "what am I watching?" is the daily question. The list now has its own route
	 * and its own tab; this page does one job.
	 */
	let { data }: { data: PageData } = $props();

	const signedIn = $derived(Boolean(page.data.user));
	const search = new MediaSearch();

	/**
	 * How many posters load eagerly at full priority.
	 *
	 * Covers the widest first row (5 columns at `lg`) with one to spare. Beyond
	 * that, eager loading stops helping and starts competing with the LCP image
	 * for bandwidth, so the rest stay lazy.
	 */
	const EAGER_POSTERS = 6;

	/**
	 * Owns pages 2..n; page 1 stays with the server load.
	 *
	 * `untrack` states the intent the compiler asks about: the flag is a starting
	 * point, not a binding. Rebuilding the feed whenever `data` changes would
	 * throw away every page the visitor had loaded each time they saved a title.
	 */
	const trending = untrack(() => new TrendingFeed(data.trending.hasMore));

	/**
	 * Merge the server's page 1 with the pages loaded since.
	 *
	 * Saving a title invalidates the page data, so page 1 is re-fetched — and the
	 * trending list is re-ranked continuously, so a title sitting in `extra` can
	 * reappear in the refreshed page 1. The grid is keyed by title, and a
	 * duplicate key is a render error, not a cosmetic glitch.
	 */
	const allTrending = $derived(dedupeByKey([...data.trending.items, ...trending.extra]));

	/**
	 * Suggestions built from the list, shown only on the default view.
	 *
	 * Once somebody is searching they have said what they are looking for, and a
	 * row of "you might also like" above the answer is just noise in front of it.
	 */
	const recommendations = $derived(search.active || search.error ? [] : data.recommendations);

	let selected = $state<{ tmdbId: number; mediaType: MediaType } | null>(null);

	/**
	 * The person whose sheet is open, if any.
	 *
	 * Held apart from `selected` but never alongside it: two `ModalSheet`s on
	 * screen at once would each answer Escape and each trap Tab, so opening one
	 * closes the other rather than stacking.
	 */
	let selectedPerson = $state<PersonResult | null>(null);

	function openPerson(person: PersonResult) {
		selected = null;
		selectedPerson = person;
	}

	function openTitle(item: { tmdbId: number; mediaType: MediaType }) {
		selectedPerson = null;
		selected = item;
	}

	/**
	 * The header's logo, asking for a clean slate.
	 *
	 * On Discover the logo's link goes to the URL already open, so nothing
	 * navigates and this component is never remounted — the search someone typed
	 * would otherwise still be sitting there under a logo they pressed to leave
	 * it. Scroll is left alone: a same-URL click already resets it.
	 *
	 * Trending pagination is deliberately not reset. Pressing the logo to get
	 * home should not throw away pages somebody asked for by hand.
	 */
	let lastReset = untrack(() => homeReset.requested);

	$effect(() => {
		const requested = homeReset.requested;
		// Only a *change* is a press. Running on mount as well used to be a
		// harmless no-op, because the search was always empty by then — until the
		// box started adopting text typed before the page came alive, which this
		// then wiped a moment after rescuing it.
		if (requested === lastReset) return;
		lastReset = requested;

		untrack(() => {
			search.clear();
			selected = null;
			selectedPerson = null;
		});
	});

	/**
	 * The loader's saved index with any in-flight save or removal laid over it.
	 *
	 * Every card and the detail sheet read from this one value, so a title that
	 * appears in a rail and in the grid flips in both places from the single tap
	 * that was actually made.
	 */
	const savedIndex = $derived(pendingSaves.overlay(data.saved));

	const selectedSaved = $derived(selected ? (savedIndex[mediaKey(selected)] ?? null) : null);

	/**
	 * The two query parameters that describe an *arrival* rather than a state:
	 * where a calendar event pointed, and how the OAuth round-trip went. Both are
	 * acted on once and then stripped, so a refresh or a back button does not
	 * replay them.
	 *
	 * `afterNavigate` rather than `$effect`, and the `await` is not decoration.
	 * `replaceState` throws until SvelteKit's client router has started, and on a
	 * first load neither an effect nor this callback is late enough — which was
	 * already happening to anyone who failed to sign in and landed on
	 * `?auth=error`: a page error instead of the message, and the parameter left
	 * in the bar. Acting comes first and tidying up waits, so the slow half
	 * cannot delay the sheet opening.
	 *
	 * Shallow routing does not re-trigger this, so stripping cannot loop.
	 */
	afterNavigate(async () => {
		const title = parseTitleParam(page.url.searchParams.get('title'));
		const outcome = page.url.searchParams.get('auth');
		if (!title && !outcome) return;

		const { pathname } = page.url;

		if (title) openTitle(title);
		if (outcome === 'error') toasts.add('Could not sign you in. Please try again.', 'error');
		else if (outcome === 'unavailable') toasts.add('Sign-in is not configured yet.', 'error');

		await tick();
		replaceState(pathname, page.state);
	});

	/**
	 * Saving a title, shown before the server has agreed to it.
	 *
	 * The toast still waits for the response. The card is the optimistic part —
	 * it is reversible and it is what the tap was aimed at — but a toast is a
	 * statement of fact, and announcing a save that then failed would be worse
	 * than announcing it a moment late.
	 */
	function addOptimistically(item: MediaResult): SubmitFunction {
		return optimistic(mediaKey(item), JUST_SAVED, withToast(`Added “${item.title}”`));
	}
</script>

<!--
	The one page a search engine can actually see, so it carries the description of
	the whole app rather than of this screen — and the structured data that lets it
	be understood as a free application instead of an untyped page of links.
-->
<Seo
	title="Nextsode — never lose your place in a series"
	description="A free watchlist for films and TV. Track series down to the episode you are on, see where to watch anything, and never mark a season watched before it has aired."
	origin={page.data.origin}
	path="/"
	schema={siteSchema(page.data.origin)}
/>

<div class="py-5 sm:py-8">
	<!--
		The heading names the product, not just the section.

		"Discover" alone was a good label and a wasted signal: it is the page's one
		`h1` and it said neither what this is nor what it is for. The subtitle picks
		up the words somebody would actually use — watchlist, episode — without
		turning into a list of them.
	-->
	<h1 class="font-display text-2xl font-extrabold sm:text-3xl">Discover films and TV</h1>
	<p class="mt-1 text-sm text-ink-muted">
		Find something worth your evening — and keep your watchlist honest, down to the episode.
	</p>

	<div class="mt-5">
		<SearchBar {search} />
	</div>

	<!--
		Personal before popular. These rows are the only part of Discover that gets
		better the longer somebody uses the app, so they lead — and each one is a
		single scrollable line, which keeps trending within reach rather than a
		screen away.
	-->
	{#if recommendations.length > 0}
		<div class="mt-7">
			{#each recommendations as rail, index (rail.seedKey)}
				<RecommendationRail
					{rail}
					{signedIn}
					priority={index === 0}
					saved={savedIndex}
					onSelect={openTitle}
					onAdd={addOptimistically}
				/>
			{/each}
		</div>
	{/if}

	<!-- The rails already carry their own bottom margin, so the gap is theirs to
	     set when they are present. -->
	<section class={recommendations.length > 0 ? '' : 'mt-7'}>
		{#if search.error}
			<p
				class="flex items-center gap-2 rounded-xl bg-rose/10 px-4 py-3 text-sm text-rose ring-1 ring-rose/20"
			>
				<Icon name="alert" size={16} />
				{search.error}
			</p>
		{:else if search.active}
			<!-- People first: a name search that leads with titles has answered the
			     wrong question. -->
			<PeopleRail people={search.people} onSelect={openPerson} />

			<!--
				The heading appears with the skeleton, not after the answer.

				It used to wait for results, which meant typing produced a bare grid of
				placeholders that said nothing about why they were there — and made the
				e2e test race a network round-trip. The count still waits, because a
				number is a claim and there is nothing to count yet.
			-->
			{#if search.loading && search.results.length === 0}
				<div class="mb-3 flex items-baseline justify-between gap-3">
					<h2 class="text-sm font-bold tracking-wide text-ink-muted uppercase">Search results</h2>
				</div>
				<PosterGridSkeleton />
			{:else if search.results.length > 0}
				<div class="mb-3 flex items-baseline justify-between gap-3">
					<h2 class="text-sm font-bold tracking-wide text-ink-muted uppercase">Search results</h2>
					<span class="text-xs text-ink-faint">{search.results.length} found</span>
				</div>
				<PosterGrid>
					{#each search.results as item, index (mediaKey(item))}
						<DiscoverCard
							{item}
							{signedIn}
							priority={index < EAGER_POSTERS}
							saved={savedIndex[mediaKey(item)] ?? null}
							onSelect={() => openTitle(item)}
							onSubmit={addOptimistically(item)}
						/>
					{/each}
				</PosterGrid>
			{:else if search.people.length > 0}
				<!--
					A name matched a person but no title, which is the whole point of
					the row above — so "no results" would be both wrong and rude. This
					says what happened and where to go next instead.
				-->
				<p class="text-sm text-ink-muted">
					No titles are named “{search.query}”. Pick a face above to see what they have been in.
				</p>
			{:else}
				<EmptyState
					icon="search"
					title={`No results for “${search.query}”`}
					hint="Try a name, a shorter title, or check the spelling."
				/>
			{/if}
		{:else if allTrending.length > 0}
			<div class="mb-3 flex items-center gap-2">
				<Icon name="flame" size={16} class="text-amber" />
				<h2 class="text-sm font-bold tracking-wide text-ink-muted uppercase">Trending this week</h2>
				<span class="text-xs text-ink-faint">{allTrending.length}</span>
			</div>
			<PosterGrid>
				{#each allTrending as item, index (mediaKey(item))}
					<DiscoverCard
						{item}
						{signedIn}
						priority={index < EAGER_POSTERS}
						saved={savedIndex[mediaKey(item)] ?? null}
						onSelect={() => openTitle(item)}
						onSubmit={addOptimistically(item)}
					/>
				{/each}
			</PosterGrid>

			{#if trending.hasMore}
				<div class="mt-6 flex flex-col items-center gap-2">
					{#if trending.error}
						<p class="flex items-center gap-2 text-sm text-rose" role="alert">
							<Icon name="alert" size={15} />
							{trending.error}
						</p>
					{/if}
					<button
						type="button"
						onclick={trending.loadMore}
						disabled={trending.loading}
						class="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-surface px-6 text-sm font-semibold text-ink ring-1 ring-line transition-colors duration-200 hover:bg-surface-hi disabled:cursor-not-allowed disabled:opacity-60"
					>
						{#if trending.loading}
							<span class="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand-hi"
							></span>
							Loading…
						{:else}
							<Icon name="plus" size={15} stroke={2.5} />
							{trending.error ? 'Try again' : 'Load more'}
						{/if}
					</button>
				</div>
			{/if}
		{:else}
			<EmptyState
				icon="alert"
				title="Trending is unavailable right now"
				hint="Search for a title above — that still works."
			/>
		{/if}
	</section>

	<!-- Signed-out prompt sits *after* the content, not in front of it: browsing
	     is open to everyone, and only saving needs an account. -->
	{#if !signedIn && page.data.authAvailable}
		<section
			class="mt-10 flex flex-col items-center gap-4 rounded-2xl bg-surface/60 px-6 py-8 text-center ring-1 ring-line sm:flex-row sm:justify-between sm:text-left"
		>
			<div class="flex items-center gap-3">
				<span
					class="hidden h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-brand/15 text-brand-hi sm:flex"
				>
					<Icon name="bookmark" size={20} />
				</span>
				<div>
					<p class="font-display font-semibold text-ink">Keep track of what you find</p>
					<p class="mt-0.5 text-sm text-ink-muted">
						Sign in to build a watchlist that's yours alone.
					</p>
				</div>
			</div>
			<div class="w-full max-w-xs sm:w-auto"><GoogleButton size="full" /></div>
		</section>
	{:else if signedIn}
		<div class="mt-10 flex justify-center">
			<a
				href={resolve('/watchlist')}
				class="flex items-center gap-2 rounded-xl bg-surface px-5 py-2.5 text-sm font-semibold text-ink-muted ring-1 ring-line transition-colors duration-200 hover:bg-surface-hi hover:text-ink"
			>
				<Icon name="bookmark" size={16} />
				Go to my list
				<Icon name="chevronRight" size={15} />
			</a>
		</div>
	{/if}
</div>

{#if selected}
	<MediaDetailModal
		tmdbId={selected.tmdbId}
		mediaType={selected.mediaType}
		saved={selectedSaved}
		{signedIn}
		country={page.data.country}
		origin={page.data.origin}
		onSelectTitle={openTitle}
		onClose={() => (selected = null)}
	/>
{/if}

{#if selectedPerson}
	<PersonSheet
		person={selectedPerson}
		onSelect={openTitle}
		onClose={() => (selectedPerson = null)}
	/>
{/if}
