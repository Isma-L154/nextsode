/**
 * Shared, client-safe types. These contain no secrets and can be imported by
 * both server and browser code (unlike anything under `$lib/server`).
 */

export type MediaType = 'movie' | 'tv';

/**
 * The signed-in user, as exposed to the UI. Deliberately a narrow subset of the
 * database row — no timestamps, no provider ids, nothing the browser can't see.
 */
export interface SessionUser {
	id: string;
	name: string;
	email: string;
	avatarUrl: string | null;
}

/**
 * A normalized, media-type-agnostic representation of a movie or TV show.
 * This is the shape our own API returns, decoupling the UI from TMDB's raw
 * response format (which differs between movies and TV shows).
 */
export interface MediaResult {
	tmdbId: number;
	mediaType: MediaType;
	title: string;
	posterPath: string | null;
	releaseDate: string | null;
	overview: string | null;
	voteAverage: number | null;
}

/**
 * The saved-row state the detail modal needs to render its controls, so it can
 * mirror the card without issuing a second query.
 */
export interface SavedEntry {
	id: string;
	watched: boolean;
	seasonsSeen: number;
	episodesIntoSeason: number;
	totalSeasons: number | null;
	airedSeasons: number | null;
}

/** A single cast member, as shown in the detail view. */
export interface CastMember {
	/** TMDB person id — what the filmography panel is fetched by. */
	id: number;
	name: string;
	character: string;
	profilePath: string | null;
}

/** One title from a person's career, as shown in the filmography panel. */
export interface PersonCredit extends MediaResult {
	/** What they played in it, when TMDB knows. */
	character: string | null;
}

/** A person as a search result: enough to recognise them by, and nothing more. */
export interface PersonResult {
	id: number;
	name: string;
	profilePath: string | null;
	/** e.g. "Acting", "Directing" — what TMDB files them under. */
	knownFor: string | null;
	/** A couple of titles, so two actors with the same name are tellable apart. */
	knownForTitles: string[];
}

/** A person and the handful of titles worth recognising them from. */
export interface PersonFilmography {
	id: number;
	name: string;
	profilePath: string | null;
	/** e.g. "Acting", "Directing" — what TMDB files them under. */
	knownFor: string | null;
	credits: PersonCredit[];
}

/** A streaming service offering a title, for the "where to watch" row. */
export interface WatchProvider {
	id: number;
	name: string;
	logoPath: string | null;
}

/**
 * Where a title can be watched in one country.
 *
 * Split by how you pay for it, because the distinction is the whole point: a
 * title included with a subscription you already have is a different answer to
 * "what should I watch tonight" than one costing £14 to buy.
 */
export interface WatchOptions {
	/** ISO 3166-1 country the offers apply to. */
	country: string;
	/** Included with a subscription. */
	stream: WatchProvider[];
	/** Free, ad-supported. */
	free: WatchProvider[];
	rent: WatchProvider[];
	buy: WatchProvider[];
	/** TMDB's own comparison page, which is what their terms ask us to link to. */
	link: string | null;
}

/**
 * A season that has not premiered yet.
 *
 * TMDB counts announced seasons in `number_of_seasons`, so without this a show
 * with three aired seasons and a fourth announced looks like a four-season show
 * you could mark as fully watched.
 */
export interface UpcomingSeason {
	number: number;
	/** `YYYY-MM-DD`, or null when TMDB has no date yet. */
	airDate: string | null;
}

/**
 * One episode of a season.
 *
 * `aired` is resolved on the server rather than left to the browser: it is the
 * ceiling for how far progress can advance, and a client clock is not something
 * a write should be validated against.
 */
export interface Episode {
	number: number;
	name: string;
	/** `YYYY-MM-DD`, or null when TMDB has no date. */
	airDate: string | null;
	runtimeMinutes: number | null;
	aired: boolean;
}

/** The episode list of a single season, when one was requested. */
export interface SeasonEpisodes {
	seasonNumber: number;
	episodes: Episode[];
	/** How many have actually aired — the write ceiling. */
	airedCount: number;
}

/** Rich details for a single title, backing the detail modal. */
export interface MediaDetails {
	tmdbId: number;
	mediaType: MediaType;
	title: string;
	overview: string | null;
	tagline: string | null;
	genres: string[];
	releaseDate: string | null;
	runtimeMinutes: number | null;
	/** TV only: total seasons, including any announced but not yet aired. */
	seasons: number | null;
	/** TV only: how many seasons have actually premiered — the tracking ceiling. */
	airedSeasons: number | null;
	/** TV only: the next season still to premiere, if there is one. */
	upcomingSeason: UpcomingSeason | null;
	/**
	 * TV only: how many episodes each numbered season holds, indexed by season
	 * number. Comes free with the details response, so the app can roll over from
	 * the last episode of a season without an extra request.
	 */
	episodeCounts: Record<number, number>;
	/** TV only: the episode list of the season that was requested, if any. */
	season: SeasonEpisodes | null;
	/**
	 * TMDB production status ("Released", "Post Production", "In Production",
	 * "Planned", "Returning Series"…). Used to explain *why* a title has no
	 * release date yet.
	 */
	productionStatus: string | null;
	voteAverage: number | null;
	/**
	 * How many TMDB users the average is drawn from.
	 *
	 * Carried purely so the public page's structured data can state it. A rating
	 * with no count behind it is the one shape search engines reject, and making
	 * one up would be worse than omitting the rating altogether.
	 */
	voteCount: number;
	backdropPath: string | null;
	posterPath: string | null;
	cast: CastMember[];
	/** YouTube video key for the trailer, if one exists. */
	trailerKey: string | null;
	/** Where to watch it in the requesting visitor's country, when TMDB knows. */
	watch: WatchOptions | null;
}
