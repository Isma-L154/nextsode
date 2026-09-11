import type { Actions } from '@sveltejs/kit';
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
export const watchlistActions = {
	...listActions,
	...sharingActions,
	...settingsActions
} satisfies Actions;
