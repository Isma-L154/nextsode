import { fail, type Action, type Actions } from '@sveltejs/kit';
import { TOO_MANY_REQUESTS, isRateLimited } from '../../rate-limit';
import { listActions } from './list';
import { sharingActions } from './sharing';
import { settingsActions } from './settings';

/**
 * Every write a visitor can make to their own list, as one action map.
 *
 * Both routes need these: Discover saves titles and My List edits them, and a
 * SvelteKit form action only exists on the route it is declared in. Rather than
 * two drifting copies, each `+page.server.ts` re-exports this one set.
 *
 * The three groups behind it have genuinely separate reasons to change — the
 * titles, the links that publish them, and the account's own settings — and
 * they were one 485-line object until they did, repeatedly, in the same file.
 * Spreading them here keeps the route contract exactly as it was.
 */
export const watchlistActions = limitPerAccount({
	...listActions,
	...sharingActions,
	...settingsActions
} satisfies Actions);

/**
 * Every write counts against the signed-in account's ceiling before it runs.
 * Signed-out calls pass straight through: each action refuses them itself.
 */
function limitPerAccount<T extends Record<string, Action>>(actions: T): T {
	const limited = Object.entries(actions).map(([name, action]) => {
		const wrapped: Action = async (event) => {
			if (await isRateLimited('ACCOUNT_RATE_LIMIT', event.locals.user?.id ?? null)) {
				return fail(429, { message: TOO_MANY_REQUESTS });
			}
			return action(event);
		};
		return [name, wrapped];
	});
	return Object.fromEntries(limited) as T;
}
