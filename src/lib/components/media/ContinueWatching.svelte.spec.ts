import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ContinueWatching from './ContinueWatching.svelte';
import type { SavedTitle } from '$lib/domain/watchlist';

/**
 * Which control the rail hands each show it is given.
 *
 * The rail draws whatever "in progress" sends it, and that used to be
 * multi-season shows alone — so it assumed the season stepper always applied.
 * Once a part-watched single season counted as in progress too, the assumption
 * showed: a show with one aired season has no stepper to draw, and drawing one
 * anyway printed "0/0" beside an empty bar. The choice between the two controls
 * is what this pins.
 */
function item(over: Partial<SavedTitle> = {}): SavedTitle {
	return {
		id: 'item-1',
		tmdbId: 1,
		mediaType: 'tv',
		title: 'Lanterns',
		posterPath: null,
		releaseDate: '2026-08-16',
		voteAverage: 8.2,
		watched: false,
		seasonsSeen: 0,
		episodesIntoSeason: 3,
		totalSeasons: 1,
		airedSeasons: 1,
		nextSeasonNumber: null,
		nextSeasonAirDate: null,
		watchedAt: null,
		...over
	};
}

function rail(over: Partial<SavedTitle> = {}) {
	const container = document.createElement('div');
	document.body.appendChild(container);

	render(ContinueWatching, {
		props: {
			items: [item(over)],
			onSelect: vi.fn(),
			onSetSeasons: () => vi.fn(),
			onToggle: () => vi.fn()
		},
		target: container
	});

	return container;
}

/** The season stepper, which submits an absolute target season. */
const stepper = (root: HTMLElement) => root.querySelector('form[action*="setSeasons"]');

/** The plain watched toggle that stands in for it. */
const toggle = (root: HTMLElement) => root.querySelector('form[action*="toggleWatched"]');

describe('ContinueWatching — which control a show gets', () => {
	it('gives a multi-season show the season stepper', () => {
		const root = rail({ title: 'Breaking Bad', seasonsSeen: 2, totalSeasons: 5, airedSeasons: 5 });

		expect(stepper(root)).not.toBeNull();
		expect(toggle(root)).toBeNull();
	});

	/** The regression: one aired season, so there is no stepper to draw. */
	it('gives a single-season show the watched toggle instead', () => {
		const root = rail();

		expect(stepper(root)).toBeNull();
		expect(toggle(root)).not.toBeNull();
	});

	/**
	 * A second season that is only announced does not raise the ceiling, so this
	 * is the single-season case wearing a larger total.
	 */
	it('treats an announced second season as the single-season case', () => {
		const root = rail({ totalSeasons: 2, nextSeasonNumber: 2, nextSeasonAirDate: '2027-01-15' });

		expect(stepper(root)).toBeNull();
		expect(toggle(root)).not.toBeNull();
	});

	// Whichever control it gets, the rail's answer to "where am I" is the note.
	it('names the next episode either way', () => {
		expect(rail().textContent).toContain('Next: S1E4');
		expect(
			rail({ seasonsSeen: 2, episodesIntoSeason: 0, totalSeasons: 5, airedSeasons: 5 }).textContent
		).toContain('Next: S3E1');
	});
});
