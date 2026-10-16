import { expect, test } from '@playwright/test';

test('an unknown route is a 404 inside the app, with a way back', async ({ page }) => {
	const response = await page.goto('/this-route-does-not-exist');
	expect(response?.status()).toBe(404);

	await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
	await expect(page).toHaveTitle('Page not found — Nextsode');
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');

	await page.getByRole('main').getByRole('link', { name: 'Browse Discover' }).click();
	await expect(page).toHaveURL('/');
});

test('a title that cannot be resolved gets the same page', async ({ page }) => {
	const response = await page.goto('/title/book/anything');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
});
