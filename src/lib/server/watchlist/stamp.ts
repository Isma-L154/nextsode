/**
 * The `watchedAt` value to store alongside a new watched state.
 *
 * Preserves an existing timestamp when something is already watched, so
 * re-deriving the flag — which the season refresh does on every visit — cannot
 * silently push the deletion countdown back to the start.
 *
 * Shared by the actions and by the refresh, which is the pairing that made the
 * bug possible in the first place.
 */
export function watchedStamp(
	nextWatched: boolean,
	current: Date | null,
	now = new Date()
): Date | null {
	if (!nextWatched) return null;
	return current ?? now;
}
