/**
 * One page, one scroll lock, however many sheets ask for it.
 *
 * Each sheet used to save `document.body.style.overflow` on mount and put it
 * back on unmount. That is correct for one sheet and wrong for two, and two
 * happens on a normal path: opening a title from inside a person's filmography
 * replaces one sheet with the other, and for a moment both are mounted.
 *
 * The arriving sheet then recorded `hidden` as the page's "previous" value,
 * because the leaving sheet had not let go yet. The leaving sheet restored the
 * empty string — unlocking the page with a dialog still open — and the arriving
 * one, on close, put `hidden` back with nothing on screen. The page stayed
 * frozen until reload.
 *
 * Counting fixes it because the question each sheet can answer alone is the
 * wrong one. "What was the overflow before me?" depends on who else is here.
 * "Is anyone still holding the lock?" does not.
 */

let holders = 0;

/** What the page had before the first holder took the lock. */
let original = '';

/**
 * Take the lock, and get back the function that releases it.
 *
 * The returned function is safe to call twice: the second call does nothing,
 * so a double teardown cannot drop the count below zero and unlock a page that
 * something else is still holding.
 */
export function lockScroll(): () => void {
	if (holders === 0) {
		original = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
	}
	holders++;

	let released = false;
	return () => {
		if (released) return;
		released = true;
		holders--;
		if (holders === 0) document.body.style.overflow = original;
	};
}

/** How many sheets currently hold the lock. Exposed for tests. */
export function scrollLockHolders(): number {
	return holders;
}
