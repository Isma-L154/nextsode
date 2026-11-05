import { getReleaseInfo } from './release';
import type { MediaDetails } from '../types';

/**
 * Where a series stands: still airing and when the next episode lands, or how
 * long it ran. This is the question the app exists to answer, and the part of a
 * title page that is not just TMDB's metadata repeated.
 */
export interface SeriesStatus {
	/** TMDB's status in sentence case, e.g. "Returning series", "Ended". */
	label: string;
	detail: string | null;
}

type StatusInput = Pick<
	MediaDetails,
	| 'mediaType'
	| 'releaseDate'
	| 'productionStatus'
	| 'seasons'
	| 'airedSeasons'
	| 'upcomingSeason'
	| 'nextEpisode'
>;

export function seriesStatus(details: StatusInput, now: Date = new Date()): SeriesStatus | null {
	if (details.mediaType !== 'tv' || !details.productionStatus) return null;
	// Before the premiere the release banner already says all there is to say.
	if (getReleaseInfo(details.releaseDate, now).state !== 'released') return null;

	return {
		label: sentenceCase(details.productionStatus),
		detail: nextAiring(details, now) ?? runLength(details)
	};
}

function nextAiring(details: StatusInput, now: Date): string | null {
	const next = details.nextEpisode;
	if (next) {
		const date = getReleaseInfo(next.airDate, now).fullDate;
		return `Next episode: S${next.season} E${next.episode}${date ? ` · ${date}` : ''}`;
	}

	const season = details.upcomingSeason;
	if (season) {
		const date = getReleaseInfo(season.airDate, now).fullDate;
		return date
			? `Season ${season.number} premieres ${date}`
			: `Season ${season.number} announced, no date yet`;
	}

	return null;
}

function runLength(details: StatusInput): string | null {
	const count = details.airedSeasons ?? details.seasons;
	return count ? `${count} season${count === 1 ? '' : 's'} aired` : null;
}

function sentenceCase(value: string): string {
	const trimmed = value.trim();
	return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}
