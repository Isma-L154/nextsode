import { hasUpcoming, type UpcomingEntry } from './upcoming';

/**
 * Auto-deleting watched titles.
 *
 * The problem is a "Watched" tab that only ever grows. This used to be solved by
 * archiving — hiding the row and keeping it forever — which bought
 * recoverability at the price of a second list, a tab to reach it, a restore
 * action, and a column on every row. Nobody went back to the archive; it was a
 * loft full of things nobody would ever ask for again. So an expired title is
 * now removed outright, and what remains is the part that was actually doing the
 * work: a window you choose, and a warning before anything goes.
 *
 * Deletion is not undoable, so the rules are deliberately conservative — a title
 * has to be watched, have a timestamp to measure from, and have nothing still to
 * come. The feature is off by default and says what it does before it does it:
 * picking a window restarts the clock on anything already past it, so no title
 * is ever destroyed without having spent its last week saying so on the card.
 * See `setAutoDelete`.
 *
 * Everything here is pure so the rules can be tested without a database — which
 * matters more than it did under archiving, because a wrong rule now costs the
 * row rather than hiding it.
 */

/** Windows offered in the UI. Null is "never", and it is the default. */
export const DELETION_WINDOWS = [7, 30, 90] as const;
export type DeletionWindow = (typeof DELETION_WINDOWS)[number];

const MS_PER_DAY = 86_400_000;

/** The fields the rules need — structurally a subset of a watchlist row. */
export interface DeletableEntry extends UpcomingEntry {
	watched: boolean;
	watchedAt: Date | null;
}

/** Validate a stored or submitted window, rejecting anything unexpected. */
export function normalizeDeletionWindow(value: unknown): DeletionWindow | null {
	const days = Number(value);
	return (DELETION_WINDOWS as readonly number[]).includes(days) ? (days as DeletionWindow) : null;
}

/**
 * Whether this entry is the *kind* of thing auto-deletion may ever touch,
 * ignoring how long ago it was watched.
 *
 * The exclusion that matters is a show with a season still to come. Being caught
 * up on a running series marks it watched, so a naive rule would delete it weeks
 * before the thing you were waiting for arrives — removing the title precisely
 * when it was about to become interesting. Anything pending is off limits; only
 * finished shows and films qualify.
 */
export function isDeletable(entry: DeletableEntry, now: Date = new Date()): boolean {
	if (!entry.watched) return false;
	if (entry.watchedAt === null) return false;
	return !hasUpcoming(entry, now);
}

/**
 * Days left before this entry is deleted, or null when it is not on the clock.
 *
 * Rounded up, so "1 day" means "some time tomorrow" rather than a countdown that
 * reads zero for most of its final day. Zero means it is due now.
 */
export function daysUntilDeletion(
	entry: DeletableEntry,
	window: DeletionWindow | null,
	now: Date = new Date()
): number | null {
	if (window === null || !isDeletable(entry, now)) return null;

	const elapsed = now.getTime() - (entry.watchedAt as Date).getTime();
	return Math.max(0, Math.ceil((window * MS_PER_DAY - elapsed) / MS_PER_DAY));
}

/** Whether the window has fully elapsed for this entry. */
export function isDueForDeletion(
	entry: DeletableEntry,
	window: DeletionWindow | null,
	now: Date = new Date()
): boolean {
	if (window === null || !isDeletable(entry, now)) return false;
	return now.getTime() - (entry.watchedAt as Date).getTime() >= window * MS_PER_DAY;
}

/**
 * How close to expiry an entry has to be before the card warns about it.
 *
 * Nothing should vanish unannounced, but a countdown on something with two
 * months left is noise — it would sit on every card permanently and stop being
 * read. A week is long enough to notice and act, and acting is one tap: the
 * warning carries the button that resets the clock.
 */
export const DELETION_WARNING_DAYS = 7;

export function shouldWarnAboutDeletion(
	entry: DeletableEntry,
	window: DeletionWindow | null,
	now: Date = new Date()
): boolean {
	const days = daysUntilDeletion(entry, window, now);
	return days !== null && days <= DELETION_WARNING_DAYS;
}
