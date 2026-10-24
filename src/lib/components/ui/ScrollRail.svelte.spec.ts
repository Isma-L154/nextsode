import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import ScrollRail from './ScrollRail.svelte';

/**
 * The arrows are the whole point of this component: the row it replaced hid its
 * scrollbar and left a wheel mouse with no way to reach the cards on the right.
 * So "an arrow appears in the direction there is something to reach, and only
 * then" is the contract, and the focus hand-off is the part that was written
 * wrong the first time — it assumed the opposite arrow existed at press time,
 * when reaching a limit is what creates it.
 */

/** Fixed-width tiles, so whether the row overflows is decided by the test. */
function tiles(count: number, width = 200) {
	return createRawSnippet(() => ({
		render: () =>
			`<div style="display:contents">${Array.from(
				{ length: count },
				(_, i) => `<div style="flex:0 0 ${width}px;height:60px"><button>Tile ${i}</button></div>`
			).join('')}</div>`
	}));
}

/** The rail sizes itself from its parent, so the parent is what the test sets. */
async function mount(count: number) {
	const screen = await render(ScrollRail, { label: 'Test rail', children: tiles(count) });
	const host = screen.container.firstElementChild as HTMLElement;
	host.style.width = '400px';
	return {
		screen,
		scroller: host.querySelector('.no-scrollbar') as HTMLElement,
		back: () => page.getByRole('button', { name: 'Back in Test rail' }),
		next: () => page.getByRole('button', { name: 'More in Test rail' })
	};
}

/** The arrows are driven by a ResizeObserver and smooth scrolling, both async. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

describe('ScrollRail', () => {
	it('shows no arrows when everything already fits', async () => {
		const { scroller, back, next } = await mount(1);
		await settle();

		expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth + 1);
		await expect.element(back()).not.toBeInTheDocument();
		await expect.element(next()).not.toBeInTheDocument();
	});

	it('offers a way forward, and only forward, at the start of an overflowing row', async () => {
		const { scroller, back, next } = await mount(10);
		await settle();

		expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
		expect(scroller.scrollLeft).toBe(0);
		await expect.element(next()).toBeInTheDocument();
		await expect.element(back()).not.toBeInTheDocument();
	});

	it('actually moves the row when the arrow is pressed', async () => {
		const { scroller, next } = await mount(10);
		await settle();

		await next().click();
		await settle();

		expect(scroller.scrollLeft).toBeGreaterThan(0);
	});

	it('retires the forward arrow at the end and offers the way back', async () => {
		const { scroller, back, next } = await mount(3);
		await settle();

		await next().click();
		await settle();

		expect(scroller.scrollLeft).toBeGreaterThan(0);
		await expect.element(next()).not.toBeInTheDocument();
		await expect.element(back()).toBeInTheDocument();
	});

	it('returns to the start, and to a row with only a way forward', async () => {
		const { scroller, back, next } = await mount(3);
		await settle();

		await next().click();
		await settle();
		await back().click();
		await settle();

		expect(scroller.scrollLeft).toBe(0);
		await expect.element(next()).toBeInTheDocument();
		await expect.element(back()).not.toBeInTheDocument();
	});

	it('hands keyboard focus to the opposite arrow when the pressed one unmounts', async () => {
		await mount(3);
		await settle();

		/**
		 * Driven by the keyboard, not by `.focus()` and `.click()`.
		 *
		 * The component only moves focus when the pressed arrow matches
		 * `:focus-visible`, which is the browser's own answer to "was this a real
		 * keyboard interaction" — and a programmatic focus does not satisfy it. A
		 * test that faked the press would prove nothing about the case this exists
		 * for.
		 */
		const forward = document.querySelector('[aria-label="More in Test rail"]') as HTMLButtonElement;
		forward.focus();
		await userEvent.keyboard('{Enter}');
		await settle();

		expect(document.querySelector('[aria-label="More in Test rail"]')).toBeNull();
		expect((document.activeElement as HTMLElement)?.getAttribute('aria-label')).toBe(
			'Back in Test rail'
		);
	});
});
