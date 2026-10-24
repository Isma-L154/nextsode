import { expect, test } from '@playwright/test';

/**
 * Smoke tests driving the real app. They run signed out, which is the only
 * state reachable without completing a live Google OAuth round-trip — so they
 * cover discovery, navigation and the auth gate, while the watchlist logic
 * itself is covered by the unit tests over `#lib`.
 */

test('shows Discover and switches to results when searching', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { name: 'Discover', level: 1 })).toBeVisible();

	const search = page.getByPlaceholder(/search movies and tv shows/i);
	await expect(search).toBeVisible();

	// Typing a query switches the section heading from trending to results.
	await search.fill('Matrix');
	await expect(page.getByRole('heading', { name: 'Search results' })).toBeVisible();
});

test('the logo puts Discover back to a clean slate', async ({ page }) => {
	await page.goto('/');

	const search = page.getByPlaceholder(/search movies and tv shows/i);
	await search.fill('Oppenheimer');
	await expect(page.getByRole('heading', { name: 'Search results' })).toBeVisible();

	/**
	 * The regression this guards: on Discover the logo's href is the URL already
	 * open, so nothing navigates and nothing remounts. Without an explicit reset
	 * the search someone typed stays sitting under the logo they pressed to
	 * leave it.
	 */
	await page.locator('header a[href$="/"]').first().click();

	await expect(search).toHaveValue('');
	await expect(page.getByRole('heading', { name: 'Trending this week' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Search results' })).toBeHidden();
});

test('navigates between Discover and My List', async ({ page }) => {
	await page.goto('/');

	// Two top-level destinations, reachable from anywhere in the app.
	await page
		.getByRole('link', { name: /my list/i })
		.first()
		.click();
	await expect(page).toHaveURL(/\/watchlist$/);
	await expect(page.getByRole('heading', { name: 'My List', level: 1 })).toBeVisible();

	await page
		.getByRole('link', { name: /discover/i })
		.first()
		.click();
	await expect(page).toHaveURL(/\/$/);
});

test('gates the watchlist behind sign-in when signed out', async ({ page }) => {
	await page.goto('/watchlist');

	// The list is not shown to anonymous visitors — they get the sign-in prompt.
	await expect(page.getByText('Your list, and only yours')).toBeVisible();

	// Discover cards offer sign-in rather than a save button that cannot work.
	await page.goto('/');
	await expect(page.getByRole('link', { name: /sign in to save/i }).first()).toBeVisible();
});

test('starts the Google OAuth flow with state and PKCE', async ({ page }) => {
	await page.goto('/');

	const response = await page.request.get('/auth/google', { maxRedirects: 0 });
	const location = response.headers()['location'] ?? '';

	// Either we are redirected to Google with the expected protections, or the
	// deployment has no credentials configured and says so instead of erroring.
	if (location.includes('accounts.google.com')) {
		expect(location).toContain('code_challenge_method=S256');
		expect(location).toContain('state=');
		expect(location).toContain('redirect_uri=');
	} else {
		expect(location).toContain('auth=unavailable');
	}
});

test('serves baseline security headers', async ({ page }) => {
	const response = await page.goto('/');
	const headers = response?.headers() ?? {};

	expect(headers['x-frame-options']).toBe('DENY');
	expect(headers['x-content-type-options']).toBe('nosniff');
	expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
	// A policy without script-src constrains nothing an injection would do.
	expect(headers['content-security-policy']).toContain("script-src 'self'");
	expect(headers['content-security-policy']).not.toContain("script-src 'self' 'unsafe-inline'");
	expect(headers['strict-transport-security']).toContain('max-age=');
	// Never on a shared public suffix: those hostnames are other people's.
	expect(headers['strict-transport-security']).not.toContain('includeSubDomains');
	// Personalised HTML must never be cacheable by a shared proxy.
	expect(headers['cache-control']).toContain('no-store');
});
