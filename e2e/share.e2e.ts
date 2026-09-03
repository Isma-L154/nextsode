import { expect, test } from '@playwright/test';

/**
 * The public side of a shared list, driven as the person it exists for:
 * somebody who was sent a link and has no account.
 *
 * Creating a link needs a session, which needs a live Google round-trip, so the
 * panel that mints one is covered by the unit tests over `watchlistActions` and
 * `$lib/server/share`. What only a browser can answer is what a stranger meets
 * at the other end of a URL, which is what these check.
 */

/** 64 hex characters that were never issued — the shape is right, the row is not. */
const UNISSUED = 'a'.repeat(64);

test('an unissued token is a 404, not a hint', async ({ page, request }) => {
	const response = await request.get(`/share/${UNISSUED}`);
	expect(response.status()).toBe(404);

	// A revoked token, a mistyped one and one that never existed must be
	// indistinguishable: "revoked" would confirm the URL was once real.
	await page.goto(`/share/${UNISSUED}`);
	const body = await page.textContent('body');
	expect(body).not.toMatch(/revoked|expired|turned off|disabled/i);
});

test('a malformed token is refused the same way', async ({ request }) => {
	expect((await request.get('/share/nope')).status()).toBe(404);
	expect((await request.get('/share/0')).status()).toBe(404);
	// Long enough to look like a token, and still not one.
	expect((await request.get(`/share/${'f'.repeat(64)}`)).status()).toBe(404);
});

test('a shared list is never cached or indexed', async ({ request }) => {
	// The headers ride on the response whether or not a list is found, so an
	// unissued token still proves the route sets them.
	const response = await request.get(`/share/${UNISSUED}`);

	expect(response.headers()['cache-control']).toContain('no-store');
	expect(response.headers()['x-robots-tag']).toContain('noindex');
});

test('robots.txt keeps crawlers out of shared lists but not titles', async ({ request }) => {
	const body = await (await request.get('/robots.txt')).text();

	expect(body).toContain('Disallow: /share/');
	expect(body).not.toContain('Disallow: /title');
});

test('the share panel is not offered to a signed-out visitor', async ({ page }) => {
	await page.goto('/watchlist');

	// Signed out, My List is a sign-in prompt. Publishing a list you cannot see
	// is not a control that should exist on it.
	await expect(page.getByText(/your list, and only yours/i)).toBeVisible();
	await expect(page.getByRole('heading', { name: /share your list/i })).toHaveCount(0);
	await expect(page.locator('input[name="toWatch"]')).toHaveCount(0);
});
