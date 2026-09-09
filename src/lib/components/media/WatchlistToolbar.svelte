<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
	import type { countByStatus } from '$lib/domain/watchlist';
	import {
		UPCOMING_FILTERS,
		UPCOMING_FILTER_LABELS,
		type countByUpcomingWindow
	} from '$lib/domain/upcoming';

	/**
	 * Filters for the saved list.
	 *
	 * Laid out in three stacked rows rather than one wrapping line: on a phone the
	 * old single row wrapped into an unpredictable shape that moved as counts
	 * changed. Rows keep the controls in the same place regardless of how many
	 * status tabs happen to exist.
	 */
	interface Props {
		counts: ReturnType<typeof countByStatus>;
		status: string;
		type: string;
		sort: string;
		query: string;
		/** Which release window the Upcoming tab is narrowed to. */
		window: string;
		/** How many pending titles sit in each window, for the chip numbers. */
		windowCounts: ReturnType<typeof countByUpcomingWindow>;
	}

	let {
		counts,
		status = $bindable(),
		type = $bindable(),
		sort = $bindable(),
		query = $bindable(),
		window = $bindable(),
		windowCounts
	}: Props = $props();

	/**
	 * "To watch" leads and is the default; there is no "All".
	 *
	 * The list exists to answer "what should I watch next", and an unfiltered
	 * view mixes that with everything already finished — so the first thing you
	 * saw was the one thing you were not looking for. Everything is still
	 * reachable, just not as the landing state.
	 *
	 * The extra lenses only earn their place once the list actually contains
	 * something they would show — an empty tab is just noise on a phone.
	 */
	const statusOptions = $derived([
		{ value: 'toWatch', label: 'To watch', count: counts.toWatch },
		...(counts.inProgress > 0
			? [{ value: 'inProgress', label: 'Watching', count: counts.inProgress }]
			: []),
		...(counts.upcoming > 0
			? [{ value: 'upcoming', label: 'Upcoming', count: counts.upcoming }]
			: []),
		{ value: 'watched', label: 'Watched', count: counts.watched }
	]);

	/**
	 * The release windows, offered as a filter rather than as headings.
	 *
	 * They used to split the view into a grid per window, which is what made a
	 * handful of titles render as several rows holding one card each. As chips
	 * they narrow a single grid, and an empty window is dropped for the same
	 * reason an empty status tab is: a chip that leads to nothing is noise.
	 */
	const windowOptions = $derived(
		UPCOMING_FILTERS.filter((value) => value === 'all' || windowCounts[value] > 0).map((value) => ({
			value,
			label: UPCOMING_FILTER_LABELS[value],
			count: windowCounts[value]
		}))
	);

	/**
	 * The Upcoming tab takes the place of the sort control rather than sitting
	 * beside it. That tab is about *when*, so it is always ordered soonest-first
	 * — the grouped view it replaces offered no ordering choice either — and
	 * "Recently added" over a list of release dates answers nobody's question.
	 */
	const showingWindows = $derived(status === 'upcoming');
</script>

<div class="space-y-2.5">
	<label class="relative block">
		<span class="sr-only">Filter your watchlist by title</span>
		<span
			class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-faint"
			aria-hidden="true"
		>
			<Icon name="filter" size={15} />
		</span>
		<input
			type="search"
			bind:value={query}
			placeholder="Filter your list…"
			autocomplete="off"
			class="w-full rounded-xl border border-line bg-surface py-2.5 pr-3 pl-10 text-base text-ink transition-colors duration-200 placeholder:text-ink-faint focus:border-brand sm:max-w-xs sm:text-sm"
		/>
	</label>

	<SegmentedControl bind:value={status} options={statusOptions} label="Filter by status" />

	<div class="flex flex-wrap items-center gap-2">
		<SegmentedControl
			bind:value={type}
			label="Filter by media type"
			options={[
				{ value: 'all', label: 'All' },
				{ value: 'movie', label: 'Movies' },
				{ value: 'tv', label: 'TV' }
			]}
		/>

		{#if showingWindows}
			<SegmentedControl
				bind:value={window}
				label="Filter by release window"
				options={windowOptions}
			/>
		{:else}
			<label class="relative">
				<span class="sr-only">Sort watchlist</span>
				<select
					bind:value={sort}
					class="cursor-pointer appearance-none rounded-xl bg-surface py-2 pr-8 pl-3 text-xs font-semibold text-ink-muted ring-1 ring-line transition-colors duration-200 hover:text-ink sm:text-sm"
				>
					<option value="recent">Recently added</option>
					<option value="rating">Top rated</option>
					<option value="title">A–Z</option>
					{#if counts.upcoming > 0}
						<option value="soonest">Releasing soonest</option>
					{/if}
				</select>
				<span
					class="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rotate-90 text-ink-faint"
					aria-hidden="true"
				>
					<Icon name="chevronRight" size={13} />
				</span>
			</label>
		{/if}
	</div>
</div>
