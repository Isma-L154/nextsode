import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import MediaCard from './MediaCard.svelte';

/**
 * The card's footer, measured rather than described.
 *
 * A two-line clamp that quietly stops clamping is invisible in a diff and
 * invisible in a unit test that only asks what the DOM contains: the title is
 * still there, still the right text, still one element. It shows up as a third
 * line of it painted over the release year — which only happens at a narrow
 * width, with a long title, on a real layout engine. So these tests measure
 * boxes.
 */

/** Narrow enough to make an ordinary film title wrap past two lines. */
const RAIL_WIDTH = 152;

const LONG_TITLE = 'The Lord of the Rings: The Fellowship of the Ring';

async function card(props: Record<string, unknown> = {}) {
	const container = document.createElement('div');
	container.style.width = `${RAIL_WIDTH}px`;
	document.body.appendChild(container);

	await render(MediaCard, {
		props: {
			title: LONG_TITLE,
			posterPath: null,
			releaseDate: '2001-12-19',
			voteAverage: 8.8,
			mediaType: 'movie',
			watched: false,
			onSelect: vi.fn(),
			...props
		},
		target: container
	});

	return container;
}

/** The clamped title element, wherever the markup chooses to put the clamp. */
const titleBox = (root: HTMLElement) => root.querySelector('.line-clamp-2') as HTMLElement;

/**
 * The button that opens the sheet from the title.
 *
 * Found through the clamp rather than by `querySelector('button')`: the poster
 * carries an overlay button of its own and comes first in the DOM, so the naive
 * selector measures a full-height poster and passes no matter what the title is
 * doing.
 */
const titleButton = (root: HTMLElement) => titleBox(root).closest('button') as HTMLElement;

/** The line under it: the year, or the progress note when there is one. */
const metaBox = (root: HTMLElement) =>
	[...root.querySelectorAll('p')].find((p) => p.textContent?.trim()) as HTMLElement;

describe('MediaCard footer', () => {
	it('keeps a long title off the line below it', async () => {
		const root = await card();
		const title = titleBox(root).getBoundingClientRect();
		const meta = metaBox(root).getBoundingClientRect();

		// The clamp has to clip where the text ends. Put it on an element that
		// also carries the hit-area padding and `overflow: hidden` clips at the
		// padding box instead, painting a third line straight over the year.
		expect(title.bottom).toBeLessThanOrEqual(meta.top);
	});

	it('actually clamps, rather than growing to fit', async () => {
		const root = await card();
		const title = titleBox(root);
		const lineHeight = parseFloat(getComputedStyle(title).lineHeight);

		expect(title.scrollHeight).toBeGreaterThan(title.clientHeight);
		expect(title.clientHeight / lineHeight).toBeLessThanOrEqual(2.2);
	});

	it('clamps nothing when the title already fits', async () => {
		const root = await card({ title: 'Up' });
		const title = titleBox(root);

		expect(title.scrollHeight).toBe(title.clientHeight);
	});

	it('leaves the progress note its own line too', async () => {
		// The note is longer than a year and renders in the same slot, so it is
		// the case most likely to be reached by a title that overflows.
		const root = await card({ note: 'Season 2 · 3 episodes in' });
		const title = titleBox(root).getBoundingClientRect();
		const meta = metaBox(root).getBoundingClientRect();

		expect(title.bottom).toBeLessThanOrEqual(meta.top);
	});

	it('gives the title a thumb-sized target even when it is one line', async () => {
		const root = await card({ title: 'Up' });
		// The padding that makes this reachable is what caused the overlap; the
		// fix has to keep the target, not trade it away.
		expect(titleButton(root).getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
	});

	it('has no title button at all when the card is not selectable', async () => {
		const root = await card({ onSelect: undefined });

		expect(titleBox(root).closest('button')).toBeNull();
		expect(titleBox(root).tagName).toBe('H3');
	});
});
