import { and, eq } from 'drizzle-orm';
import { watchlistItem } from '../db/schema';

/**
 * Match a row by id *and* owner.
 *
 * The id alone would be enough to find the row, which is exactly the problem.
 * Item ids travel through the browser as form fields, so knowing one must not
 * be enough to use it: someone else's id simply matches nothing.
 *
 * Shared by the actions and by the refresh, like `watchedStamp` above it. The
 * refresh reads its ids from rows it already loaded for one account, so the
 * scope is redundant there today — and that is the point. It stops being
 * redundant the moment those rows come from somewhere else, and a write that
 * only fails once its caller changes is a write nobody remembers to fix.
 */
export function ownedRow(id: string, userId: string) {
	return and(eq(watchlistItem.id, id), eq(watchlistItem.userId, userId));
}
