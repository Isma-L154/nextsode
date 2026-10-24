<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';
	import { uniqueBy } from '#lib/domain/media.js';
	import { providerLogoUrl } from '#lib/format/tmdb-image.js';
	import type { WatchOptions, WatchProvider } from '#lib/types.js';

	/**
	 * Where a title can actually be watched, in the visitor's country.
	 *
	 * This answers the question that immediately follows "I want to see this",
	 * and that the app previously left hanging: a watchlist of eighty titles is
	 * useless if none of them tell you which one you can start tonight.
	 *
	 * Subscription services come first and stay visually loudest, because a title
	 * included with something you already pay for is a different answer from one
	 * that costs money to rent.
	 */
	interface Props {
		watch: WatchOptions;
		title: string;
	}

	let { watch, title }: Props = $props();

	/**
	 * Rent and buy are the same decision — "pay per view" — so they share a row
	 * rather than splitting the section into four near-identical strips. A service
	 * usually appears under both, so its logo is shown once.
	 */
	const paid = $derived(uniqueBy([...watch.rent, ...watch.buy], (provider) => provider.id));

	const regionName = $derived.by(() => {
		try {
			return new Intl.DisplayNames(['en'], { type: 'region' }).of(watch.country) ?? watch.country;
		} catch {
			return watch.country;
		}
	});
</script>

{#snippet row(label: string, providers: WatchProvider[], emphasis: boolean)}
	{#if providers.length > 0}
		<div class="flex flex-wrap items-center gap-2">
			<span class="w-16 flex-shrink-0 text-[11px] font-semibold text-ink-faint">{label}</span>
			{#each providers as provider (provider.id)}
				{@const logo = providerLogoUrl(provider.logoPath)}
				<span
					title={provider.name}
					class="flex items-center gap-1.5 rounded-lg py-1 pr-2.5 pl-1 ring-1 transition-colors duration-200
						{emphasis ? 'bg-brand/12 ring-brand/25' : 'bg-surface-hi ring-line'}"
				>
					{#if logo}
						<img
							src={logo}
							alt=""
							width="24"
							height="24"
							loading="lazy"
							class="h-6 w-6 rounded-md object-cover"
						/>
					{:else}
						<span
							class="flex h-6 w-6 items-center justify-center rounded-md bg-surface text-ink-faint"
						>
							<Icon name="play" size={11} filled />
						</span>
					{/if}
					<span class="text-[11px] font-medium {emphasis ? 'text-ink' : 'text-ink-muted'}">
						{provider.name}
					</span>
				</span>
			{/each}
		</div>
	{/if}
{/snippet}

<section aria-labelledby="watch-heading" class="mt-6">
	<div class="flex items-baseline justify-between gap-3">
		<h3 id="watch-heading" class="text-[11px] font-bold tracking-widest text-ink-muted uppercase">
			Where to watch
		</h3>
		<span class="text-xs text-ink-faint">{regionName}</span>
	</div>

	<div class="mt-3 space-y-2">
		{@render row('Stream', watch.stream, true)}
		{@render row('Free', watch.free, true)}
		{@render row('Rent/buy', paid, false)}
	</div>

	<!--
		TMDB's terms require attributing availability data to JustWatch and linking
		back to their page rather than presenting the offers as ours.
	-->
	{#if watch.link}
		<!-- eslint-disable svelte/no-navigation-without-resolve -- resolve() maps this app's own routes; this one points off-site to TMDB by design -->
		<a
			href={watch.link}
			target="_blank"
			rel="noopener noreferrer"
			class="mt-3 inline-flex items-center gap-1 text-[11px] text-ink-faint transition-colors duration-200 hover:text-ink-muted"
		>
			Availability for {title} via JustWatch
			<Icon name="chevronRight" size={11} />
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{/if}
</section>
