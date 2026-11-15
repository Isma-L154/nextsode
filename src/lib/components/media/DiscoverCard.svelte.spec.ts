import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DiscoverCard from './DiscoverCard.svelte';
import type { MediaResult } from '#lib/types.js';

describe('DiscoverCard add form', () => {
	/** The add action's schema is strict: any extra field makes every save fail. */
	it('posts only the title identity accepted by the add action', async () => {
		const item: MediaResult = {
			tmdbId: 157336,
			mediaType: 'movie',
			title: 'Interstellar',
			posterPath: null,
			releaseDate: '2014-11-05',
			overview: 'Explorers travel through a wormhole in space.',
			voteAverage: 8.5
		};
		const container = document.createElement('div');
		document.body.appendChild(container);

		await render(DiscoverCard, {
			props: {
				item,
				signedIn: true,
				saved: null,
				onSelect: vi.fn(),
				onSubmit: vi.fn()
			},
			target: container
		});

		const form = container.querySelector('form[action="?/add"]') as HTMLFormElement;
		const data = new FormData(form);

		expect([...data.keys()]).toEqual(['tmdbId', 'mediaType']);
		expect(data.get('tmdbId')).toBe(String(item.tmdbId));
		expect(data.get('mediaType')).toBe(item.mediaType);
	});
});
