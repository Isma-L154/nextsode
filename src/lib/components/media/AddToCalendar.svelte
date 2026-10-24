<script lang="ts">
	import { page } from '$app/state';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { googleCalendarUrl } from '#lib/domain/calendar.js';
	import type { MediaDetails } from '#lib/types.js';

	/**
	 * One tap to put this title's date in a calendar.
	 *
	 * Needs no account on either side: it is a URL Google fills a form from, so
	 * it works signed out and asks for no permission we would have to be granted.
	 *
	 * What it makes is a copy, and a copy does not follow TMDB when a release
	 * slips. That is what the subscribable feed on My List is for, and why both
	 * exist rather than one.
	 */
	interface Props {
		details: MediaDetails;
	}

	let { details }: Props = $props();

	/**
	 * Only rendered when there is a day to name — an announced title with no date
	 * yet gets nothing, because a calendar has nowhere to put it.
	 */
	const href = $derived(
		googleCalendarUrl(
			{
				tmdbId: details.tmdbId,
				title: details.title,
				mediaType: details.mediaType,
				releaseDate: details.releaseDate,
				nextSeasonNumber: details.upcomingSeason?.number ?? null,
				nextSeasonAirDate: details.upcomingSeason?.airDate ?? null
			},
			{ origin: page.data.origin }
		)
	);
</script>

{#if href}
	<!-- eslint-disable svelte/no-navigation-without-resolve -- resolve() maps this app's own routes; this one hands the event to Google Calendar -->
	<a
		{href}
		target="_blank"
		rel="noopener noreferrer"
		class="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-surface-hi px-3.5 text-xs font-semibold text-ink-muted ring-1 ring-line transition-colors duration-200 ring-inset hover:bg-line hover:text-ink"
	>
		<Icon name="calendar" size={14} />
		Add to calendar
	</a>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
{/if}
