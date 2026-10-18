import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Renders the brand images from `docs/brand/banner.html`: the repository banner
 * and the site's card, which is its link preview and search result image.
 *
 * They are drawn rather than painted: built from the same palette, typeface and
 * film mark the app itself uses, so they stay right when the brand moves. One
 * source with two variants, so the card cannot drift from the banner either.
 * Regenerate with `npm run brand`.
 *
 * Deliberately contains no recognisable characters. Posters here are archetypes
 * — a spaceship, a crown, a silhouette in a hat — because "films and TV" reads
 * perfectly well from those, and putting somebody else's characters on a public
 * repository is a legal problem rather than a design one.
 */
const TARGETS = [
	{ variant: 'banner', width: 1280, height: 640, path: 'docs/brand/nextsode-banner.png' },
	// The size `SITE_IMAGE` in src/lib/format/seo.ts declares.
	{ variant: 'card', width: 1200, height: 630, path: 'static/og.png' }
];

/** Inlined as data URIs: the render must not depend on a network or a font cache. */
function font(path) {
	return `data:font/woff2;base64,${readFileSync(path).toString('base64')}`;
}

const html = readFileSync('docs/brand/banner.html', 'utf8')
	.replace(
		'__OUTFIT__',
		font('node_modules/@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2')
	)
	.replace(
		'__WORK_SANS__',
		font('node_modules/@fontsource-variable/work-sans/files/work-sans-latin-wght-normal.woff2')
	);

const browser = await chromium.launch();

for (const { variant, width, height, path } of TARGETS) {
	const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
	await page.setContent(html, { waitUntil: 'load' });
	await page.evaluate((name) => (document.documentElement.dataset.variant = name), variant);
	await page.evaluate(() => document.fonts.ready);
	await page.locator('#banner').screenshot({ path });
	await page.close();

	const bytes = readFileSync(path).length;
	console.log(`${path} — ${width}x${height}, ${Math.round(bytes / 1024)}KB`);
}

await browser.close();
