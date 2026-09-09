<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Icon from '$lib/components/ui/Icon.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import GoogleButton from '$lib/components/auth/GoogleButton.svelte';
	import PosterGrid from '$lib/components/media/PosterGrid.svelte';
	import WatchlistCard from '$lib/components/media/WatchlistCard.svelte';
	import WatchlistToolbar from '$lib/components/media/WatchlistToolbar.svelte';
	import ContinueWatching from '$lib/components/media/ContinueWatching.svelte';
	import AutoDeleteControl from '$lib/components/media/AutoDeleteControl.svelte';
	import CalendarFeed from '$lib/components/media/CalendarFeed.svelte';
	import ShareList from '$lib/components/media/ShareList.svelte';
	import MediaDetailModal from '$lib/components/media/MediaDetailModal.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { absorb, withToast } from '$lib/forms/feedback';
	import { pendingSaves } from '$lib/stores/pending-saves.svelte';
	import { applyWatchlistView, countByStatus, isInProgress } from '$lib/domain/watchlist';
	import { countByUpcomingWindow } from '$lib/domain/upcoming';
	import { mediaKey } from '$lib/domain/media';
	import type { WatchlistItem } from '$lib/server/db/schema';
	import type { MediaType, SavedEntry } from '$lib/types';
	import type { PageData } from './$types';

	/**
	 * My List — everything saved, and what to do with it next.
	 *
	 * Owning a whole route is the point: the list is the reason the app exists, so
	 * it is one tap away from anywhere instead of a scroll to the bottom of
	 * Discover.
	 */
	let { data }: { data: PageData } = $props();

	const signedIn = $derived(Boolean(page.data.user));

	/**
	 * How many posters load eagerly at full priority — see the same constant on
	 * Discover. Lazy-loading the tile that turns out to be the LCP element costs
	 * measurable paint time, and the first row is never below the fold.
	 */
	const EAGER_POSTERS = 6;

	// --- View state (strings, to pair with SegmentedControl) ---
	// Opens on "To watch" rather than everything: the list is here to answer
	// "what next", and finished titles are the one thing that is never the answer.
	let statusTab = $state('toWatch');
	let typeFilter = $state('all');
	let sortBy = $state('recent');
	let listQuery = $state('');
	/** Which release window Upcoming is narrowed to; ignored on every other tab. */
	let upcomingWindow = $state('all');

	let selected = $state<{ tmdbId: number; mediaType: MediaType } | null>(null);

	/**
	 * The list, minus anything the detail sheet has just been asked to remove.
	 *
	 * Without this the sheet and the grid would disagree for as long as the
	 * request takes: the sheet offering to save the title back while its card
	 * still sat in the grid behind it. The tile leaves with the tap; if the
	 * server refuses, the refreshed data puts it straight back.
	 */
	const items = $derived(data.items.filter((item) => !pendingSaves.removed(mediaKey(item))));

	const counts = $derived(countByStatus(items));

	/**
	 * Shows that are started but unfinished, surfaced above the grid.
	 *
	 * Shown on the default view only: once the user has actively narrowed the
	 * list, a rail that ignores their filter is contradicting them. In-progress
	 * shows are unwatched, so they belong under "To watch" as well.
	 */
	const continueWatching = $derived(
		statusTab === 'toWatch' && typeFilter === 'all' && listQuery.trim() === ''
			? items.filter(isInProgress)
			: []
	);

	/**
	 * Upcoming is always soonest-first. It is the tab about *when*, and the
	 * grouped view it replaces imposed that order too, so nothing is taken away.
	 */
	const effectiveSort = $derived(statusTab === 'upcoming' ? 'soonest' : sortBy);

	const visibleItems = $derived(
		applyWatchlistView(items, {
			status: statusTab,
			type: typeFilter,
			sort: effectiveSort,
			query: listQuery,
			window: upcomingWindow
		})
	);

	/**
	 * The numbers on the window chips.
	 *
	 * Counted from the same set the grid draws from, minus the window itself —
	 * so a chip reading "3" can never lead to an empty grid once the type or the
	 * search box has already narrowed things.
	 */
	const upcomingWindowCounts = $derived(
		countByUpcomingWindow(
			applyWatchlistView(items, {
				status: 'upcoming',
				type: typeFilter,
				sort: 'recent',
				query: listQuery,
				window: 'all'
			})
		)
	);

	// "<tmdbId>:<mediaType>" -> saved row, so the modal renders the same controls
	// as the card without issuing a second query. Pending changes are laid over
	// the top, which is what lets the sheet answer a tap before the server does —
	// including saving a title reached from "more like this", which is not in the
	// list at all and so cannot be covered by the filter above.
	const savedEntries = $derived(
		pendingSaves.overlay(
			Object.fromEntries(
				items.map((item): [string, SavedEntry] => [
					mediaKey(item),
					{
						id: item.id,
						watched: item.watched,
						seasonsSeen: item.seasonsSeen,
						episodesIntoSeason: item.episodesIntoSeason,
						totalSeasons: item.totalSeasons,
						airedSeasons: item.airedSeasons
					}
				])
			)
		)
	);

	const selectedSaved = $derived(selected ? (savedEntries[mediaKey(selected)] ?? null) : null);

	/** True when the view is narrowed past its default landing state. */
	const filtersActive = $derived(
		statusTab !== 'toWatch' || typeFilter !== 'all' || listQuery.trim() !== ''
	);

	function resetFilters() {
		statusTab = 'toWatch';
		typeFilter = 'all';
		listQuery = '';
		// Cleared with the rest, or coming back to Upcoming would land on a
		// narrowing the viewer had already asked to be rid of.
		upcomingWindow = 'all';
	}

	/**
	 * Season updates take their message from the server's response rather than
	 * from the pre-click state: the action may have discovered a newly aired
	 * season, so only it knows how far there is left to go.
	 *
	 * The wording distinguishes the two ends. "Caught up" means there is nothing
	 * left *right now*; "Finished" is reserved for a show with nothing still to
	 * air, which is the only case where it is true.
	 */
	function seasonProgressToast(item: Pick<WatchlistItem, 'title'>): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				const payload = (await absorb(result, update)) as {
					seasonsSeen?: number;
					airedSeasons?: number;
					totalSeasons?: number | null;
				} | null;
				if (!payload) return;

				const seen = payload.seasonsSeen ?? 0;
				const aired = payload.airedSeasons ?? 0;
				const total = payload.totalSeasons ?? aired;

				if (aired && seen >= aired) {
					toasts.add(
						total > aired ? `Caught up on “${item.title}” 🎉` : `Finished “${item.title}” 🎉`
					);
				} else if (seen === 0) toasts.add(`Reset progress for “${item.title}”`, 'info');
				else toasts.add(`Season ${seen} of “${item.title}” watched`);
			};
	}
</script>

<!--
	Never indexed. Signed in it is private by definition, and signed out it is a
	sign-in prompt — ranking a locked door helps nobody who finds it.
-->
<Seo
	title="My List — Nextsode"
	description="Your personal list of films and TV shows to watch."
	origin={page.data.origin}
	path="/watchlist"
	indexable={false}
/>

<div class="py-5 sm:py-8">
	<div class="mb-5 flex items-baseline justify-between gap-3">
		<div>
			<h1 class="font-display text-2xl font-extrabold sm:text-3xl">My List</h1>
			<p class="mt-1 text-sm text-ink-muted">
				{#if signedIn && counts.all > 0}
					{counts.all}
					{counts.all === 1 ? 'title' : 'titles'} saved · {counts.toWatch} left to watch
				{:else}
					Everything you've saved, in one place.
				{/if}
			</p>
		</div>
	</div>

	{#if !signedIn}
		<!-- Signed-out state. Browsing stays open; the list itself is private. -->
		<EmptyState
			icon="lock"
			title="Your list, and only yours"
			hint="Sign in with Google to save titles. Your watchlist stays tied to your account — nobody else can see or change it."
		>
			{#snippet action()}
				{#if page.data.authAvailable}
					<div class="mx-auto w-full max-w-xs"><GoogleButton size="full" /></div>
				{:else}
					<p class="text-xs text-amber">Sign-in is not configured on this deployment yet.</p>
				{/if}
			{/snippet}
		</EmptyState>
	{:else if counts.all === 0}
		<EmptyState
			icon="sparkle"
			title="Your watchlist is empty"
			hint="Head to Discover to search for a title or pick something trending."
		>
			{#snippet action()}
				<a
					href={resolve('/')}
					class="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand/30 transition-colors duration-200 hover:bg-brand-hi"
				>
					<Icon name="compass" size={16} />
					Browse Discover
				</a>
			{/snippet}
		</EmptyState>
	{:else}
		<ContinueWatching
			items={continueWatching}
			onSelect={(item) => (selected = item)}
			onSetSeasons={seasonProgressToast}
		/>

		<div class="mb-4">
			<WatchlistToolbar
				{counts}
				bind:status={statusTab}
				bind:type={typeFilter}
				bind:sort={sortBy}
				bind:query={listQuery}
				bind:window={upcomingWindow}
				windowCounts={upcomingWindowCounts}
			/>
		</div>

		<!-- Shown where it applies: the tab full of the titles it governs. -->
		{#if statusTab === 'watched'}
			<AutoDeleteControl current={data.autoDeleteDays} />
		{/if}

		<!--
			On the two tabs whose titles a link can actually contain. Not on
			Upcoming, which is a view over "to watch" rather than a third thing to
			share, and which already carries the calendar feed — two panels about
			two different links, stacked, would be a choice nobody asked to make.
		-->
		{#if statusTab === 'toWatch' || statusTab === 'watched'}
			<ShareList token={data.shareToken} scope={data.shareScope} origin={page.data.origin} />
		{/if}

		{#if visibleItems.length === 0}
			<EmptyState
				icon="filter"
				title={listQuery.trim()
					? `No matches for “${listQuery}”`
					: 'Nothing here with these filters'}
				hint="Try widening the filters to see the rest of your list."
			>
				{#snippet action()}
					<button
						type="button"
						onclick={resetFilters}
						class="cursor-pointer rounded-xl bg-surface-hi px-4 py-2 text-sm font-semibold text-ink ring-1 ring-line transition-colors duration-200 hover:bg-line"
					>
						Clear filters
					</button>
				{/snippet}
			</EmptyState>
		{:else}
			{#if filtersActive}
				<p class="mb-3 text-xs text-ink-faint" role="status" aria-live="polite">
					Showing {visibleItems.length} of {counts.all}
				</p>
			{/if}

			{#if statusTab === 'upcoming'}
				<!-- Offered here rather than in a settings screen: this is the tab
				     about when things happen, which is the only place subscribing a
				     calendar to the list means anything. -->
				<CalendarFeed token={data.calendarToken} origin={page.data.origin} />
			{/if}

			<!--
				One grid, on every tab.

				Upcoming used to render its own bucketed layout, a separate grid per
				time window. Two things came of that and both were bugs: a handful of
				titles spread across four windows became four rows holding one card
				each, and the caption under every card overflowed its cell — the card
				fills the cell by design, so a sibling below it had nowhere to go and
				landed on the next heading. The windows are a filter now, so this tab
				draws from the same grid as the rest of the list.
			-->
			<PosterGrid>
				{#each visibleItems as item, index (item.id)}
					<div
						animate:flip={{ duration: 250 }}
						in:fade={{ duration: 200 }}
						out:fade={{ duration: 150 }}
					>
						<WatchlistCard
							{item}
							priority={index < EAGER_POSTERS}
							deleteWindow={data.autoDeleteDays}
							onSelect={() => (selected = item)}
							onToggle={withToast(item.watched ? 'Moved back to your list' : 'Marked as watched')}
							onSetSeasons={seasonProgressToast(item)}
							onRemove={withToast(`Removed “${item.title}”`, 'info')}
							onKeep={withToast(`Keeping “${item.title}” on your list`, 'info')}
						/>
					</div>
				{/each}
			</PosterGrid>
		{/if}
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
		onSelectTitle={(item) => (selected = item)}
		onClose={() => (selected = null)}
	/>
{/if}
