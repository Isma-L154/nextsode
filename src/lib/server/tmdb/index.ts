/**
 * The TMDB client's public surface.
 *
 * It was one 612-line module covering search, details, seasons, trending,
 * recommendations and people — six endpoint families whose only genuinely
 * shared parts are the fetch and two raw response shapes, now in `client`.
 * Re-exported from here so every existing `$lib/server/tmdb` import is
 * untouched by the split.
 */
export { searchMulti, type SearchResults } from './search';
export { normalizeSeasonEpisodes, splitSeasons, type SeasonBreakdown } from './seasons';
export { getDetails } from './details';
export { getRecommendations } from './recommendations';
export { getTrending, type TrendingPage } from './trending';
export { getPersonFilmography } from './person';
