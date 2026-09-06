import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import WatchlistCard from './WatchlistCard.svelte';
import type { WatchlistItem } from '$lib/server/db/schema';

/**
 * Which control a saved title gets, and whether what replaces it fits.
 *
 * The rule itself is covered in `domain/release`, where it belongs. What only a
 * layout engine can answer is the second half: the release line stands in the
 * width a button used to occupy, and a far-off date carries its year —
 * "Premieres Sep 30, 2028" does not fit a poster tile on one line. It is allowed
 * to wrap instead of truncate, because a cut year is the part worth reading. So
 * this measures, the way `MediaCard`'s own tests do.
 */

/** A poster tile at its narrowest — five columns on a desktop grid. */
const TILE_WIDTH = 155;

/**
 * The longest label the slot can be asked to hold: the long verb, a day-precise
 * date, and a year — which `formatDate` adds as soon as it is not this one.
 */
const LONGEST = { mediaType: 'tv' as const, releaseDate: '2099-09-30' };

function item(over: Partial<WatchlistItem> = {}): WatchlistItem {
	return {
		id: 'item-1',
		userId: 'user-1',
		tmdbId: 1,
		mediaType: 'movie',
		title: 'Interstellar',
		posterPath: null,
		releaseDate: '2014-11-05',
		overview: null,
		voteAverage: 8.5,
		watched: false,
		seasonsSeen: 0,
		episodesIntoSeason: 0,
		totalSeasons: null,
		airedSeasons: null,
		nextSeasonNumber: null,
		nextSeasonAirDate: null,
		watchedAt: null,
		addedAt: new Date(),
		...over
	};
}

function card(over: Partial<WatchlistItem> = {}) {
	const container = document.createElement('div');
	container.style.width = `${TILE_WIDTH}px`;
	document.body.appendChild(container);

	render(WatchlistCard, {
		props: {
			item: item(over),
			onSelect: vi.fn(),
			onToggle: vi.fn(),
			onSetSeasons: vi.fn(),
			onRemove: vi.fn()
		},
		target: container
	});

	return container;
}

/** The form that would mark this title watched, if the card offers one. */
const toggleForm = (root: HTMLElement) => root.querySelector('form[action*="toggleWatched"]');

/** The release line that stands in its place, if it does not. */
const releaseLine = (root: HTMLElement) => root.querySelector('p.text-amber span') as HTMLElement;

describe('WatchlistCard — waiting for a release', () => {
	it('offers the toggle on a title that is out', () => {
		const root = card();

		expect(toggleForm(root)).not.toBeNull();
		expect(releaseLine(root)).toBeNull();
	});

	it('replaces the toggle with the release date on a title that is not', () => {
		const root = card({ releaseDate: '2099-08-14' });

		expect(toggleForm(root)).toBeNull();
		expect(releaseLine(root).textContent?.trim()).toBe('Out Aug 14, 2099');
	});

	it('says what a series is doing, not what a film is', () => {
		const root = card({ mediaType: 'tv', releaseDate: '2099-08-14' });

		expect(releaseLine(root).textContent?.trim()).toBe('Premieres Aug 14, 2099');
	});

	// Not knowing when something came out is not knowing that it has not; see
	// `canMarkWatched`.
	it('still offers the toggle when TMDB has no date at all', () => {
		const root = card({ releaseDate: null });

		expect(toggleForm(root)).not.toBeNull();
		expect(releaseLine(root)).toBeNull();
	});

	/**
	 * The way back out is never taken away. A row saved before this rule, or one
	 * whose date TMDB has since moved outwards, must not be left claiming
	 * something its owner cannot take back.
	 */
	it('keeps the toggle on a watched title even once its date is in the future', () => {
		const root = card({ releaseDate: '2099-08-14', watched: true });

		expect(toggleForm(root)).not.toBeNull();
		expect(releaseLine(root)).toBeNull();
	});

	it('leaves the remove button alone', () => {
		const root = card({ releaseDate: '2099-08-14' });

		expect(root.querySelector('form[action*="remove"]')).not.toBeNull();
	});

	// The reason this file measures rather than only reading text.
	it('shows the longest label it can be given in full, wrapping if it must', () => {
		const root = card(LONGEST);
		const line = releaseLine(root);
		const pill = line.closest('p') as HTMLElement;

		expect(line.textContent?.trim()).toBe('Premieres Sep 30, 2099');
		// Nothing clipped horizontally, and the wrap stays inside the slot the
		// button used to occupy, so a row of cards stays level.
		expect(line.scrollWidth).toBeLessThanOrEqual(line.clientWidth);
		expect(pill.scrollHeight).toBeLessThanOrEqual(pill.clientHeight);
	});
});
