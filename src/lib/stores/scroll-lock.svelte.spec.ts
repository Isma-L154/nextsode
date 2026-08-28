import { afterEach, describe, expect, it } from 'vitest';
import { lockScroll, scrollLockHolders } from './scroll-lock';

/**
 * The counting is the whole point, so these are about arithmetic under the
 * orders that actually happen — including the one that caused the bug, where a
 * second holder arrives before the first has let go.
 *
 * Named `.svelte.spec.ts` for the environment, not the module: that suffix is
 * what puts a test in the browser project here, and this one touches
 * `document.body`. `feedback.svelte.spec.ts` is here for the same reason.
 */
afterEach(() => {
	document.body.style.overflow = '';
});

describe('lockScroll', () => {
	it('locks on the first holder and unlocks on the last', () => {
		const release = lockScroll();
		expect(document.body.style.overflow).toBe('hidden');

		release();
		expect(document.body.style.overflow).toBe('');
		expect(scrollLockHolders()).toBe(0);
	});

	it('stays locked while a second holder is still there', () => {
		const first = lockScroll();
		const second = lockScroll();

		first();
		// This is the moment the page used to unlock with a dialog still open.
		expect(document.body.style.overflow).toBe('hidden');

		second();
		expect(document.body.style.overflow).toBe('');
	});

	it('unlocks correctly when holders leave in the order they arrived', () => {
		const first = lockScroll();
		const second = lockScroll();

		second();
		expect(document.body.style.overflow).toBe('hidden');
		first();
		expect(document.body.style.overflow).toBe('');
	});

	it('restores what the page had, not a blank string', () => {
		document.body.style.overflow = 'clip';

		const release = lockScroll();
		expect(document.body.style.overflow).toBe('hidden');
		release();

		expect(document.body.style.overflow).toBe('clip');
	});

	it('does not record the locked value as the original', () => {
		// The bug in one line: a second holder must not treat `hidden` as the
		// state to go back to.
		const first = lockScroll();
		const second = lockScroll();
		first();
		second();

		expect(document.body.style.overflow).toBe('');
	});

	it('ignores a release called twice', () => {
		const first = lockScroll();
		const second = lockScroll();

		first();
		first();

		// Without the guard the count would now be wrong and the page would
		// unlock underneath the sheet that is still open.
		expect(scrollLockHolders()).toBe(1);
		expect(document.body.style.overflow).toBe('hidden');

		second();
		expect(document.body.style.overflow).toBe('');
	});

	it('handles many open and close cycles without drifting', () => {
		for (let i = 0; i < 5; i++) lockScroll()();
		expect(scrollLockHolders()).toBe(0);
		expect(document.body.style.overflow).toBe('');
	});
});
