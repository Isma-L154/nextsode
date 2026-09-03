/**
 * What a shared list shows, and what it is called.
 *
 * The scope is the whole of the owner's control over a public link, so it lives
 * here rather than being spelled out at each of the four places that touch it —
 * the form that sets it, the column that stores it, the query that reads it and
 * the page that explains it. Adding a fourth scope should mean editing this
 * file and nothing else.
 */

/** The parts of a list somebody might be willing to publish. */
export const SHARE_SCOPES = ['toWatch', 'watched', 'both'] as const;

export type ShareScope = (typeof SHARE_SCOPES)[number];

/**
 * What a link shows when nothing says otherwise.
 *
 * "To watch" rather than everything, on the same reasoning as the tab My List
 * opens on: the list exists to answer "what next", and that is also the half
 * people mean when they offer to show somebody their list. Widening it is one
 * checkbox; noticing you published more than you meant to is not.
 */
export const DEFAULT_SHARE_SCOPE: ShareScope = 'toWatch';

/**
 * Read a scope back from storage or from a form, falling back to the default.
 *
 * Anything unrecognised narrows rather than widens. A column written by an
 * older deploy, a hand-edited form field, a value from a scope that has since
 * been removed — none of them should be able to publish the half of a list its
 * owner did not agree to.
 */
export function normalizeShareScope(value: unknown): ShareScope {
	return SHARE_SCOPES.includes(value as ShareScope) ? (value as ShareScope) : DEFAULT_SHARE_SCOPE;
}

/** Whether a scope includes titles in the given state. */
export function scopeIncludes(scope: ShareScope, watched: boolean): boolean {
	if (scope === 'both') return true;
	return watched ? scope === 'watched' : scope === 'toWatch';
}

/**
 * The scope two checkboxes describe, or null when neither is ticked.
 *
 * Null is not a scope — it is the absence of one, and the caller's cue to
 * refuse. There is no way to spell "share my list, showing nothing", and
 * silently substituting a default would publish something nobody asked for.
 */
export function scopeFromChoices(toWatch: boolean, watched: boolean): ShareScope | null {
	if (toWatch && watched) return 'both';
	if (toWatch) return 'toWatch';
	if (watched) return 'watched';
	return null;
}

/** How a scope reads on the shared page, under the owner's name. */
export function describeScope(scope: ShareScope, counts: { toWatch: number; watched: number }) {
	const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

	switch (scope) {
		case 'toWatch':
			return `${plural(counts.toWatch, 'title')} to watch`;
		case 'watched':
			return `${plural(counts.watched, 'title')} already watched`;
		case 'both':
			return `${plural(counts.toWatch, 'title')} to watch · ${counts.watched} watched`;
	}
}

/**
 * The owner's first name, which is all a shared page ever says about them.
 *
 * Enough to answer "whose list is this" for somebody who was sent the link by
 * that person, and not a full legal name published at a URL that can be
 * forwarded anywhere. Falls back to a name rather than to nothing: a page
 * headed "'s list" is worse than one that does not claim to know.
 */
export function ownerFirstName(name: string): string {
	return name.trim().split(/\s+/)[0] || 'Someone';
}
