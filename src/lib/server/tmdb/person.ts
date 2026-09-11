import { normalize, tmdbFetch, type TmdbRawResult } from './client';
import { PERSON_CREDITS_SIZE, rankCredits, type CreditCandidate } from '$lib/domain/filmography';
import type { MediaType, PersonCredit, PersonFilmography } from '$lib/types';

/** One person's record, and their whole career in a single response. */

/** A person's own record, and their whole career in one response. */
interface TmdbPersonCreditRaw extends TmdbRawResult {
	character?: string;
	popularity?: number;
	vote_count?: number;
	episode_count?: number;
}

interface TmdbPersonRaw {
	id: number;
	name?: string;
	profile_path?: string | null;
	known_for_department?: string;
	combined_credits?: { cast?: TmdbPersonCreditRaw[] };
}

/**
 * A career changes about as often as a birthday, so this caches for a day at the
 * edge like recommendations do. Keyed by person id and identical for everyone.
 */
const PERSON_CACHE_SECONDS = 86_400;

/**
 * Who somebody is, and the few titles worth recognising them from.
 *
 * `combined_credits` is appended rather than fetched separately: the panel needs
 * both halves before it can render anything, and two round trips from the worker
 * to TMDB would be paid on every face a viewer taps.
 *
 * The ranking is deliberately not done here — see `domain/filmography` for what
 * "worth recognising" means and why it is not simply the most recent five.
 */
export async function getPersonFilmography(personId: number): Promise<PersonFilmography> {
	const raw = await tmdbFetch<TmdbPersonRaw>(
		`/person/${personId}`,
		{ language: 'en-US', append_to_response: 'combined_credits' },
		PERSON_CACHE_SECONDS
	);

	const candidates = (raw.combined_credits?.cast ?? [])
		.filter(
			(credit): credit is TmdbPersonCreditRaw & { media_type: MediaType } =>
				credit.media_type === 'movie' || credit.media_type === 'tv'
		)
		.map((credit): PersonCredit & CreditCandidate => ({
			...normalize(credit, credit.media_type),
			character: credit.character?.trim() || null,
			voteCount: credit.vote_count ?? 0,
			popularity: credit.popularity ?? 0,
			episodeCount: credit.media_type === 'tv' ? (credit.episode_count ?? null) : null
		}));

	return {
		id: raw.id,
		name: raw.name?.trim() || 'Unknown',
		profilePath: raw.profile_path ?? null,
		knownFor: raw.known_for_department?.trim() || null,
		// Ranking fields are dropped here rather than carried to the client: the
		// order is the answer, and the numbers behind it are not the browser's
		// business.
		credits: rankCredits(candidates, PERSON_CREDITS_SIZE).map(
			({
				tmdbId,
				mediaType,
				title,
				posterPath,
				releaseDate,
				overview,
				voteAverage,
				character
			}) => ({
				tmdbId,
				mediaType,
				title,
				posterPath,
				releaseDate,
				overview,
				voteAverage,
				character
			})
		)
	};
}
