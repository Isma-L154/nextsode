/**
 * The watchlist server module.
 *
 * Split by what the code *does*, because the single file this replaced had
 * grown to five jobs and 675 lines — and two of the three bugs found in it were
 * a rule applied in one place and forgotten in another.
 *
 *   queries  — reading a list
 *   actions  — every write a visitor can make
 *   upkeep   — the repairs that run while somebody is looking
 *   seasons  — asking TMDB, and what its silence means
 *
 * Re-exported from here so callers keep importing `$lib/server/watchlist` and
 * never need to know which of those a name came from.
 */
export { loadWatchlist, countWatchlist, type WatchlistRow } from './queries';
export { watchlistActions } from './actions';
export { refreshSeasonData, deleteExpired } from './upkeep';
