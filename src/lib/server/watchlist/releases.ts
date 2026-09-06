import { getDetails } from '../tmdb';
import type { MediaType } from '$lib/types';

/**
 * Asking TMDB when a title actually comes out, now that the answer matters.
 *
 * A release date used to be decoration: a year under a poster, a badge, a line
 * in the calendar feed. Being wrong cost nothing anybody would notice. It stops
 * being decoration the moment "Watched" is withheld on the strength of it —
 * a date that has quietly moved is then a card its owner cannot use.
 *
 * The snapshot taken when a title is saved is never revised anywhere else, and
 * release dates move constantly: films slip, films are pulled forward, and a
 * placeholder year becomes a real day. So the read path re-asks, exactly the way
 * it already re-asks about seasons.
 */

/**
 * The current release date for one title, or null when TMDB could not be asked.
 *
 * Null means "no answer", not "no date" — the caller leaves the row alone rather
 * than writing an absence over a date it already had. TMDB genuinely having no
 * date comes back as the string being absent, which is a value worth storing:
 * a date that was withdrawn is news.
 */
export async function resolveReleaseDate(
	mediaType: MediaType,
	tmdbId: number
): Promise<{ releaseDate: string | null } | null> {
	try {
		const details = await getDetails(mediaType, tmdbId);
		return { releaseDate: details.releaseDate };
	} catch (err) {
		console.error('Failed to read release date for %s/%d:', mediaType, tmdbId, err);
		return null;
	}
}
