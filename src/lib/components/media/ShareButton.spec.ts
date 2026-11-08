import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ShareButton from './ShareButton.svelte';

/** Guards against lost clicks on the server-rendered button before hydration. */
describe('ShareButton server rendering', () => {
	it('renders the button disabled before hydration', () => {
		const { body } = render(ShareButton, {
			props: {
				url: 'https://nextsode.cloudils.com/title/movie/157336-interstellar',
				title: 'Interstellar'
			}
		});

		expect(body).toMatch(/<button\b[^>]*\sdisabled(?:\s|=|>)/);
	});
});
