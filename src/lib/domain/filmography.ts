import type { MediaType } from '#lib/types.js';

/**
 * Turning a person's full credit list into the handful of titles you would
 * actually recognise them from.
 *
 * TMDB's combined credits are a career, not a highlight reel: a working actor
 * has hundreds of entries, most of them one-episode guest spots, unreleased
 * projects and documentaries about themselves. Shown raw they answer the
 * opposite of the question being asked — "where do I know them from" needs the
 * five titles a viewer has heard of, not the five most recent.
 *
 * Kept out of the TMDB client so the ranking can be argued with in tests rather
 * than by opening the app and squinting at a panel.
 */

/**
 * How many titles the inline panel in a detail sheet shows.
 *
 * Small on purpose. That panel opens inside a sheet that is already about
 * something else — it answers "what else have I seen them in" and then gets out
 * of the way.
 */
export const FILMOGRAPHY_SIZE = 5;

/**
 * How many titles the API returns, which is as far as a viewer can browse.
 *
 * Deliberately more than the panel shows. One cached response serves both the
 * five-row aside inside a detail sheet and the full grid a person's own sheet
 * opens with — splitting them would mean two edge-cache entries for the same
 * career, and a viewer who taps a face in one place then searches for the same
 * name paying for it twice.
 *
 * Not the whole career either: past twenty, credits are voice cameos, archive
 * footage and documentaries about the person, which is where a filmography stops
 * being a list of things anyone watched.
 */
export const PERSON_CREDITS_SIZE = 20;

/**
 * How many people a search shows.
 *
 * A strip above the titles, not a page of its own — a name search should still
 * lead with what to watch. Anyone past the eighth match for a name is not who
 * was being looked for.
 */
export const PEOPLE_RESULTS_SIZE = 8;

/**
 * Identity for a credit, so a panel can be asked to leave one out.
 *
 * The title the sheet is already open on is always the person's top credit here
 * — it is why their face is on the screen — and a panel whose first row is the
 * thing you are looking at wastes a fifth of itself saying nothing.
 */
export function creditKey(credit: Pick<CreditCandidate, 'tmdbId' | 'mediaType'>): string {
	return `${credit.mediaType}:${credit.tmdbId}`;
}

/** The fields ranking actually reads. Callers pass their own richer rows through. */
export interface CreditCandidate {
	tmdbId: number;
	mediaType: MediaType;
	posterPath: string | null;
	/** Total ratings cast. The proxy for "how many people have seen this". */
	voteCount: number;
	/** TMDB's current-attention score, used only to break ties. */
	popularity: number;
	/** TV only: how many episodes the person appeared in. */
	episodeCount: number | null;
}

/**
 * A guest appearance is not a credit worth showing.
 *
 * Combined credits make no distinction between a series regular and someone who
 * turned up in one episode of a procedural fifteen years ago — both are a row
 * with the show's name on it, and the show's own vote count, which is what makes
 * them outrank real roles. Two episodes is the cheapest line that separates
 * "was in it" from "walked past it"; TV credits with no episode count at all are
 * left alone, because absent is not the same as small.
 */
const MIN_EPISODES = 2;

export function isSubstantial(credit: CreditCandidate): boolean {
	if (credit.mediaType !== 'tv' || credit.episodeCount === null) return true;
	return credit.episodeCount >= MIN_EPISODES;
}

/**
 * Rank a person's credits and keep the best `limit` of them.
 *
 * Ordered by vote count rather than by popularity, deliberately. Popularity is a
 * measure of this week — it puts whatever the person is currently promoting
 * above the role they are famous for, which is the wrong answer to the question
 * the panel is opened to ask. Vote count is cumulative and so encodes durable
 * recognition; popularity survives only as the tiebreak between titles nobody
 * has rated.
 *
 * Titles with no poster are dropped rather than ranked. The panel is a strip of
 * artwork, and a placeholder tile carries no information at the size it renders
 * at — it costs a row and says nothing.
 *
 * Duplicates are collapsed first, not last: a recurring character is listed once
 * per credited role, and without this a panel of five can be the same show five
 * times.
 */
export function rankCredits<T extends CreditCandidate>(credits: T[], limit: number): T[] {
	const seen = new Set<string>();
	const unique: T[] = [];

	for (const credit of credits) {
		if (!credit.posterPath || !isSubstantial(credit)) continue;
		const id = creditKey(credit);
		if (seen.has(id)) continue;
		seen.add(id);
		unique.push(credit);
	}

	return unique
		.sort((a, b) => b.voteCount - a.voteCount || b.popularity - a.popularity)
		.slice(0, Math.max(0, limit));
}

/** The fields person ranking reads, kept minimal for the same reason above. */
export interface PersonCandidate {
	id: number;
	profilePath: string | null;
	popularity: number;
}

/**
 * Rank the people a search matched.
 *
 * By popularity, and here that is the right measure rather than the wrong one:
 * a name is not a title, so there is nothing cumulative to sort by, and someone
 * typing "hemsworth" means the Hemsworth currently in things — not the earliest
 * TMDB id to carry the name.
 *
 * People with no photograph are dropped. The strip is a row of faces and a
 * placeholder circle is not one; worse, TMDB's person index is full of one-line
 * crew entries with no photo and no credits, and unfiltered they push the actual
 * actor out of a strip this short.
 */
export function rankPeople<T extends PersonCandidate>(people: T[], limit: number): T[] {
	const seen = new Set<number>();

	return people
		.filter((person) => {
			if (!person.profilePath || seen.has(person.id)) return false;
			seen.add(person.id);
			return true;
		})
		.sort((a, b) => b.popularity - a.popularity)
		.slice(0, Math.max(0, limit));
}
