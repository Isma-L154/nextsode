import { and, eq } from 'drizzle-orm';
import { watchlistItem } from '../../db/schema';

/**
 * The two things every group of actions needs, and nothing else.
 *
 * Kept apart from any one of them so that adding a third group does not mean
 * picking which existing file to import from.
 */

/** Returned by every action when the caller has no session. */
export const UNAUTHENTICATED = { message: 'Please sign in first.' };

/**
 * Match a row by id *and* owner.
 *
 * The id alone would be enough to find the row, which is exactly the problem.
 * Item ids travel through the browser as form fields, so knowing one must not
 * be enough to use it: someone else's id simply matches nothing.
 */
export function ownedRow(id: string, userId: string) {
	return and(eq(watchlistItem.id, id), eq(watchlistItem.userId, userId));
}
