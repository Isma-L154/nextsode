import { expect, test } from '@playwright/test';

/**
 * A title's public page, driven as the visitor it exists for: somebody who was
 * sent a link, has no account, and has never seen this app.
 *
 * Signed out is not a limitation of the harness here — it is the case under
 * test. Everything below has to work with no session, no cookie and, for the
 * card tags, no JavaScript run at all.
 */

const INTERSTELLAR = '/title/movie/157336-interstellar';

test('a stranger can read a shared title without an account', async ({ page }) => {
	await page.goto(INTERSTELLAR);

	await expect(page.getByRole('heading', { name: 'Interstellar', level: 1 })).toBeVisible();
	await expect(page.getByText(/wormhole/i).first()).toBeVisible();

	// The one thing they can do, and the honest version of it: no account, so the
	// page offers to make one rather than pretending to save.
	await expect(page.getByRole('link', { name: /sign in/i }).first()).toBeVisible();
});

test('the page carries the tags a chat app unfurls', async ({ request }) => {
	const response = await request.get(INTERSTELLAR);
	expect(response.status()).toBe(200);
	const html = await response.text();

	// The film's own artwork, not the house image: a shared film that arrives
	// under `og.png` reads as an ad for the app.
	expect(html).toContain('property="og:image" content="https://image.tmdb.org/');
	expect(html).toContain('property="og:type" content="video.movie"');
	expect(html).toMatch(/<title>Interstellar \(2014\)/);

	// Structured data, which is the difference between a page of words and a
	// known film with a year and a rating.
	expect(html).toContain('"@type":"Movie"');
});

test('progress controls stay out of a page with no list behind it', async ({ page }) => {
	// A show, so the season controls would have something to attach to if they
	// were rendered at all.
	await page.goto('/title/tv/1396-breaking-bad');

	await expect(page.getByRole('heading', { name: 'Breaking Bad', level: 1 })).toBeVisible();
	await expect(page.getByRole('button', { name: /season/i })).toHaveCount(0);
	await expect(page.getByText(/episodes watched/i)).toHaveCount(0);
});

test('a stale or edited slug lands on the canonical URL', async ({ page }) => {
	await page.goto('/title/movie/157336-whatever-somebody-typed');

	await expect(page).toHaveURL(INTERSTELLAR);
	await expect(page.getByRole('heading', { name: 'Interstellar', level: 1 })).toBeVisible();
});

test('a slug that addresses nothing is a 404, not a blank page', async ({ request }) => {
	expect((await request.get('/title/movie/not-an-id')).status()).toBe(404);
	expect((await request.get('/title/person/12345-nope')).status()).toBe(404);
});

test('sharing reveals the link when the clipboard is unavailable', async ({ page, context }) => {
	// Deny the permission rather than stub the API: what is under test is the
	// fallback a real browser takes when the write is refused.
	await context.grantPermissions([]);
	await page.goto(INTERSTELLAR);

	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
	});
	await page.reload();

	await page.getByRole('button', { name: /share interstellar/i }).click();

	// Either the clipboard took it, or the URL is now on screen to be copied by
	// hand. Both are a pass; silently doing nothing is not.
	const revealed = page.getByRole('textbox', { name: /link to interstellar/i });
	const copied = page.getByText(/link copied/i);
	await expect(revealed.or(copied).first()).toBeVisible();
});
