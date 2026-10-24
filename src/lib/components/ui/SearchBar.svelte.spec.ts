import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SearchBar from './SearchBar.svelte';
import { MediaSearch } from '#lib/stores/search.svelte.js';

/**
 * What happens to text that was already in the box when this component woke up.
 *
 * The box is server-rendered, so somebody can type into it seconds before the
 * script that makes it search has loaded. Svelte's binding adopts that text,
 * which looks like everything is fine — but no `oninput` ever fired, so nothing
 * was ever searched. The page then switches to the results view and reports
 * "no results" for a search it never ran: a wrong answer rather than a slow one.
 */
async function mount(query = '') {
	const search = new MediaSearch();
	search.query = query;
	// Stubbed rather than allowed to run: this asserts that a search is asked
	// for, and a component test has no business reaching the network.
	const onInput = vi.spyOn(search, 'onInput').mockImplementation(() => {});

	await render(SearchBar, { search });
	return { search, onInput };
}

describe('SearchBar', () => {
	it('searches for text that was already in the box', async () => {
		const { onInput } = await mount('Matrix');

		expect(onInput).toHaveBeenCalledTimes(1);
	});

	it('asks for nothing when the box was empty', async () => {
		const { onInput } = await mount('');

		expect(onInput).not.toHaveBeenCalled();
	});

	it('does not ask twice for the same text', async () => {
		// The adopted query stays in the store; a second request for it would
		// double every search on a slow first load.
		const { onInput } = await mount('Matrix');
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(onInput).toHaveBeenCalledTimes(1);
	});

	it('leaves the adopted text in the box', async () => {
		const { search } = await mount('Matrix');
		const input = document.querySelector<HTMLInputElement>('input[type="search"]');

		expect(input?.value).toBe('Matrix');
		expect(search.query).toBe('Matrix');
	});
});
