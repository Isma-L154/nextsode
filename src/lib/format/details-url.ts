import type { MediaType } from '#lib/types.js';

/** What the detail sheet is asking for. */
export interface DetailsQuery {
	tmdbId: number;
	mediaType: MediaType;
	/** ISO country for streaming availability. */
	country: string;
	/** The season whose episodes to fetch, or null for none. */
	season: number | null;
}

/**
 * The proxy URL for one title, with the season only when one is being tracked.
 *
 * A plain module rather than part of the store: `URLSearchParams` is mutable,
 * and a rune file is rightly not allowed to hold one — the lint rule cannot tell
 * scratch state inside a function from state meant to drive reactivity.
 */
export function detailsUrl({ tmdbId, mediaType, country, season }: DetailsQuery): string {
	const params = new URLSearchParams({ country });
	if (season) params.set('season', String(season));
	return `/api/details/${mediaType}/${tmdbId}?${params}`;
}
