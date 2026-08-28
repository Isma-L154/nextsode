import { describe, expect, it, vi } from 'vitest';
import { createRawSnippet, tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import ModalSheet from './ModalSheet.svelte';

/**
 * The behaviour in `ModalSheet` is the kind that is invisible when it breaks:
 * focus quietly walking out of the dialog, a scroll lock that never lifts, a
 * close that returns focus to a node that no longer exists. None of it shows up
 * in a diff, which is why it is worth pinning here.
 */

/** Two focusable controls, so a Tab trap has something to cycle between. */
const children = createRawSnippet(() => ({
	render: () =>
		`<div><button data-testid="first">First</button><button data-testid="last">Last</button></div>`
}));

function open(onClose = vi.fn()) {
	const screen = render(ModalSheet, { label: 'Test sheet', onClose, children });
	return { screen, onClose };
}

describe('ModalSheet', () => {
	it('names the dialog for assistive tech', async () => {
		open();
		await expect.element(page.getByRole('dialog', { name: 'Test sheet' })).toBeInTheDocument();
	});

	it('closes on Escape', async () => {
		const { onClose } = open();
		await userEvent.keyboard('{Escape}');
		expect(onClose).toHaveBeenCalled();
	});

	it('closes from the close button', async () => {
		const { onClose } = open();
		await page.getByRole('button', { name: 'Close' }).click();
		expect(onClose).toHaveBeenCalled();
	});

	it('closes when the backdrop is clicked', async () => {
		const { onClose, screen } = open();
		const backdrop = screen.container.querySelector('[role="presentation"]') as HTMLElement;
		backdrop.click();
		expect(onClose).toHaveBeenCalled();
	});

	it('stays open when the sheet itself is clicked', async () => {
		const { onClose } = open();
		await page.getByTestId('first').click();
		expect(onClose).not.toHaveBeenCalled();
	});

	it('moves focus into the dialog on open', async () => {
		const { screen } = open();
		const dialog = screen.container.querySelector('[role="dialog"]');
		expect(document.activeElement).toBe(dialog);
	});

	it('locks the background scroll while open and restores it on close', async () => {
		document.body.style.overflow = 'scroll';

		const { screen } = open();
		expect(document.body.style.overflow).toBe('hidden');

		screen.unmount();
		expect(document.body.style.overflow).toBe('scroll');

		document.body.style.overflow = '';
	});

	/*
	 * Focus identity is compared as a boolean throughout.
	 * `expect(activeElement).toBe(someButton)` resolves to a `Response` overload
	 * in the browser matchers and does not type-check, which is a quirk of the
	 * matcher types rather than anything to do with what is being asserted.
	 */
	it('returns focus to whatever opened it', async () => {
		const opener = document.createElement('button');
		opener.textContent = 'Opener';
		// `appendChild`, not `append`: the Workers types in `tsconfig` shadow
		// `append` with a signature that takes a Response, and it stops
		// type-checking against an element.
		document.body.appendChild(opener);
		opener.focus();
		expect(document.activeElement === opener).toBe(true);

		const { screen } = open();
		expect(document.activeElement === opener).toBe(false);

		screen.unmount();
		expect(document.activeElement === opener).toBe(true);

		opener.remove();
	});

	it('wraps Tab from the last control back to the first', async () => {
		open();
		const last = document.querySelector('[data-testid="last"]') as HTMLElement;
		last.focus();

		await userEvent.keyboard('{Tab}');

		// The close button is the dialog's first focusable, ahead of the children.
		expect((document.activeElement as HTMLElement)?.getAttribute('aria-label')).toBe('Close');
	});

	it('wraps Shift+Tab from the first control back to the last', async () => {
		open();
		const close = document.querySelector('[aria-label="Close"]') as HTMLElement;
		close.focus();

		await userEvent.keyboard('{Shift>}{Tab}{/Shift}');

		expect((document.activeElement as HTMLElement)?.dataset.testid).toBe('last');
	});

	it('cannot let Tab escape into the page behind it', async () => {
		const outside = document.createElement('button');
		outside.textContent = 'Behind the dialog';
		document.body.appendChild(outside);

		open();
		const last = document.querySelector('[data-testid="last"]') as HTMLElement;
		last.focus();
		await userEvent.keyboard('{Tab}');

		expect(document.activeElement === outside).toBe(false);
		outside.remove();
	});
});

describe('ModalSheet drag-to-dismiss', () => {
	/**
	 * The sheet drew a grab handle long before it answered one. These pin the
	 * behaviour that handle promises, and the three cases where the gesture must
	 * deliberately do nothing.
	 */
	function dragBy(distance: number, pointerType = 'touch') {
		const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
		const send = (type: string, y: number) =>
			dialog.dispatchEvent(
				new PointerEvent(type, { pointerType, clientX: 180, clientY: y, bubbles: true })
			);

		send('pointerdown', 40);
		for (let step = 1; step <= 8; step++) send('pointermove', 40 + (distance * step) / 8);
		send('pointerup', 40 + distance);
		return dialog;
	}

	it('closes when pulled down past the threshold', async () => {
		const { onClose } = open();
		dragBy(220);
		expect(onClose).toHaveBeenCalled();
	});

	it('springs back from a short pull instead of closing', async () => {
		const { onClose } = open();
		const dialog = dragBy(40);
		expect(onClose).not.toHaveBeenCalled();
		// Back at rest, not left hanging part-way down.
		expect(dialog.style.transform).toBe('');
	});

	it('ignores a mouse drag, which would only break text selection', async () => {
		const { onClose } = open();
		dragBy(220, 'mouse');
		expect(onClose).not.toHaveBeenCalled();
	});

	it('lets a scrolled sheet keep scrolling rather than dismissing', async () => {
		const { onClose, screen } = open();
		const dialog = screen.container.querySelector('[role="dialog"]') as HTMLElement;
		// A sheet read part-way down must not close when the reader flicks on.
		Object.defineProperty(dialog, 'scrollTop', { value: 300, configurable: true });

		dragBy(220);
		expect(onClose).not.toHaveBeenCalled();
	});

	it('does not move the sheet when pulled upward', async () => {
		const { onClose } = open();
		const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
		const send = (type: string, y: number) =>
			dialog.dispatchEvent(
				new PointerEvent(type, { pointerType: 'touch', clientX: 180, clientY: y, bubbles: true })
			);

		/**
		 * Asserted mid-gesture, on purpose.
		 *
		 * Releasing resets the offset either way, so checking after `pointerup`
		 * proves nothing — a sheet that slid upward the whole time would still end
		 * at rest and still not close. The bug only exists while the finger is
		 * down.
		 */
		send('pointerdown', 200);
		send('pointermove', 80);
		await tick();

		expect(dialog.style.transform).toBe('');

		send('pointerup', 80);
		expect(onClose).not.toHaveBeenCalled();
	});
});

describe('two sheets swapping places', () => {
	/**
	 * Opening a title from inside a person's filmography does not stack sheets —
	 * it replaces one with the other. For a moment both are mounted, and each
	 * believes it owns the scroll lock.
	 *
	 * The bug that produced these tests: the arriving sheet recorded `hidden` as
	 * the page's "previous" overflow, because the leaving sheet had not let go
	 * yet. The leaving sheet then restored the empty string — unlocking the page
	 * while a dialog was still open — and the arriving sheet, on close, put
	 * `hidden` back with nothing on screen. The page stayed frozen until reload.
	 */
	it('leaves the page scrollable after the second sheet closes', async () => {
		const first = render(ModalSheet, { label: 'Person', onClose: vi.fn(), children });
		await tick();

		const second = render(ModalSheet, { label: 'Title', onClose: vi.fn(), children });
		await tick();
		first.unmount();
		await tick();

		// While a sheet is still open the page must stay locked.
		expect(document.body.style.overflow).toBe('hidden');

		second.unmount();
		await tick();

		expect(document.body.style.overflow).toBe('');
	});

	it('stays locked while any sheet is still on screen', async () => {
		const first = render(ModalSheet, { label: 'Person', onClose: vi.fn(), children });
		await tick();
		const second = render(ModalSheet, { label: 'Title', onClose: vi.fn(), children });
		await tick();

		first.unmount();
		await tick();

		// The page was unlocked here, with the second sheet open behind it.
		expect(document.body.style.overflow).toBe('hidden');

		second.unmount();
		await tick();
	});

	it('survives opening and closing several in a row', async () => {
		for (let i = 0; i < 4; i++) {
			const sheet = render(ModalSheet, { label: `Sheet ${i}`, onClose: vi.fn(), children });
			await tick();
			sheet.unmount();
			await tick();
			expect(document.body.style.overflow).toBe('');
		}
	});

	it('respects an overflow the page already had', async () => {
		// Nothing sets this today, but restoring a blank string unconditionally
		// would be the same class of bug in the other direction.
		document.body.style.overflow = 'clip';

		const sheet = render(ModalSheet, { label: 'Sheet', onClose: vi.fn(), children });
		await tick();
		sheet.unmount();
		await tick();

		expect(document.body.style.overflow).toBe('clip');
		document.body.style.overflow = '';
	});
});
