import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SHARE_SCOPE,
	describeScope,
	normalizeShareScope,
	ownerFirstName,
	scopeFromChoices,
	scopeIncludes
} from './share';

describe('normalizeShareScope', () => {
	it('keeps every scope it recognises', () => {
		expect(normalizeShareScope('toWatch')).toBe('toWatch');
		expect(normalizeShareScope('watched')).toBe('watched');
		expect(normalizeShareScope('both')).toBe('both');
	});

	/**
	 * The rule that matters: an unreadable value must never end up publishing
	 * more than the owner agreed to. A hand-edited form field, a column written
	 * by an older deploy, a scope since removed — all of them narrow.
	 */
	it('narrows to the default rather than widening', () => {
		for (const value of [null, undefined, '', 'BOTH', 'everything', 42, {}]) {
			expect(normalizeShareScope(value)).toBe(DEFAULT_SHARE_SCOPE);
		}
		expect(DEFAULT_SHARE_SCOPE).not.toBe('both');
	});
});

describe('scopeIncludes', () => {
	it('shows only what its scope names', () => {
		expect(scopeIncludes('toWatch', false)).toBe(true);
		expect(scopeIncludes('toWatch', true)).toBe(false);

		expect(scopeIncludes('watched', true)).toBe(true);
		expect(scopeIncludes('watched', false)).toBe(false);

		expect(scopeIncludes('both', true)).toBe(true);
		expect(scopeIncludes('both', false)).toBe(true);
	});
});

describe('scopeFromChoices', () => {
	it('reads the two checkboxes', () => {
		expect(scopeFromChoices(true, false)).toBe('toWatch');
		expect(scopeFromChoices(false, true)).toBe('watched');
		expect(scopeFromChoices(true, true)).toBe('both');
	});

	// There is no way to spell "share my list, showing nothing", and defaulting
	// here would publish something nobody ticked.
	it('refuses rather than defaulting when neither is ticked', () => {
		expect(scopeFromChoices(false, false)).toBeNull();
	});
});

describe('describeScope', () => {
	const counts = { toWatch: 12, watched: 4 };

	it('says what the page is showing', () => {
		expect(describeScope('toWatch', counts)).toBe('12 titles to watch');
		expect(describeScope('watched', counts)).toBe('4 titles already watched');
		expect(describeScope('both', counts)).toBe('12 titles to watch · 4 watched');
	});

	it('counts one title as one title', () => {
		expect(describeScope('toWatch', { toWatch: 1, watched: 0 })).toBe('1 title to watch');
		expect(describeScope('watched', { toWatch: 0, watched: 1 })).toBe('1 title already watched');
	});

	it('handles an empty list without reading as broken', () => {
		expect(describeScope('toWatch', { toWatch: 0, watched: 0 })).toBe('0 titles to watch');
	});
});

describe('ownerFirstName', () => {
	// All a shared page ever says about its owner: enough to place them, not a
	// full legal name published at a forwardable URL.
	it('takes the first name and nothing else', () => {
		expect(ownerFirstName('Ismael Leon')).toBe('Ismael');
		expect(ownerFirstName('Ada')).toBe('Ada');
		expect(ownerFirstName('  Grace   Hopper ')).toBe('Grace');
	});

	it('names somebody rather than nobody', () => {
		expect(ownerFirstName('')).toBe('Someone');
		expect(ownerFirstName('   ')).toBe('Someone');
	});
});
