import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ShareButton from './ShareButton.svelte';

/** Guards mounted sharing and the manual-copy fallback when clipboard access is denied. */
const url = 'https://nextsode.cloudils.com/title/movie/157336-interstellar';
const title = 'Interstellar';
const shareDescriptor = Object.getOwnPropertyDescriptor(navigator, 'share');

afterEach(() => {
	vi.restoreAllMocks();
	if (shareDescriptor) {
		Object.defineProperty(navigator, 'share', shareDescriptor);
	} else {
		Reflect.deleteProperty(navigator, 'share');
	}
});

describe('ShareButton', () => {
	it('enables sharing once mounted', async () => {
		await render(ShareButton, { props: { url, title } });

		await expect.element(page.getByRole('button', { name: `Share ${title}` })).toBeEnabled();
	});

	it('reveals the link when clipboard access is denied', async () => {
		Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
		vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
			new DOMException('denied', 'NotAllowedError')
		);
		await render(ShareButton, { props: { url, title } });

		await page.getByRole('button', { name: `Share ${title}` }).click();

		await expect.element(page.getByRole('textbox', { name: `Link to ${title}` })).toHaveValue(url);
	});
});
