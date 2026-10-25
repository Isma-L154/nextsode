import { fail, type Actions } from '@sveltejs/kit';
import * as v from 'valibot';
import { issueCalendarToken, revokeCalendarToken } from '../../calendar';
import { issueShareToken, revokeShareToken, setShareScope } from '../../share';
import { scopeFromChoices } from '#lib/domain/share.js';
import { INVALID_FORM, checkbox, readForm } from '../../validation';
import { UNAUTHENTICATED } from './shared';

/**
 * Handing the list to somebody else: the calendar feed, and the public page.
 *
 * Two links rather than one, and deliberately separate tokens — turning off a
 * page sent to a friend must not unsubscribe a calendar.
 */

/**
 * The scope the share form is asking for: null when it names nothing, and
 * `invalid` when the body is not the share form at all.
 *
 * An unchecked box is absent from a form body rather than false, so presence is
 * the whole test. Both actions that write a scope read it through here, which is
 * what keeps "neither box ticked" one rule rather than two.
 */
const shareForm = v.strictObject({ toWatch: checkbox, watched: checkbox });

async function readShareScope(request: Request) {
	const input = await readForm(request, shareForm);
	if (!input) return 'invalid' as const;
	return scopeFromChoices(input.toWatch === 'on', input.watched === 'on');
}

export const sharingActions = {
	/**
	 * Turn the calendar feed on, or roll it over.
	 *
	 * One action for both, because they are the same operation: a new token
	 * replaces whatever was there. Rolling over is how somebody takes back a URL
	 * that ended up somewhere it should not have, and it necessarily breaks every
	 * subscription made with the old one — which is the point, and which the UI
	 * says out loud before doing it.
	 */
	issueCalendarFeed: async ({ locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);
		await issueCalendarToken(locals.user.id);
		return { calendar: 'issued' as const };
	},

	/** Turn the calendar feed off, invalidating every subscription to it. */
	revokeCalendarFeed: async ({ locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);
		await revokeCalendarToken(locals.user.id);
		return { calendar: 'revoked' as const };
	},

	/**
	 * Turn the share link on, or roll it over.
	 *
	 * The scope arrives with the request rather than being assumed, because the
	 * two checkboxes and the button are one decision: nobody creates a link and
	 * then wonders what is on it. Neither box ticked is refused outright — there
	 * is no way to spell "share my list, showing nothing", and quietly picking a
	 * default here would publish something the owner did not tick.
	 */
	issueShareLink: async ({ request, locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);

		const scope = await readShareScope(request);
		if (scope === 'invalid') return fail(400, INVALID_FORM);
		if (!scope) return fail(400, { message: 'Choose what to share first.' });

		await issueShareToken(locals.user.id, scope);
		return { share: 'issued' as const };
	},

	/**
	 * Change what the existing link shows, keeping the link itself.
	 *
	 * Separate from issuing on purpose. Widening a scope is not a request to
	 * break the URL already sent, and narrowing one only achieves anything if it
	 * is the same URL that starts showing less.
	 */
	updateShareScope: async ({ request, locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);

		const scope = await readShareScope(request);
		if (scope === 'invalid') return fail(400, INVALID_FORM);
		if (!scope) return fail(400, { message: 'Choose what to share first.' });

		await setShareScope(locals.user.id, scope);
		return { share: 'updated' as const };
	},

	/** Turn the share link off, so every copy of the URL stops resolving. */
	revokeShareLink: async ({ locals }) => {
		if (!locals.user) return fail(401, UNAUTHENTICATED);
		await revokeShareToken(locals.user.id);
		return { share: 'revoked' as const };
	}
} satisfies Actions;
