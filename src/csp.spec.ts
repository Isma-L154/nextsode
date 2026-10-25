import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The CSP allows SvelteKit's route announcer by the hash of its style
 * attribute. A SvelteKit update that rewrites that attribute would leave the
 * announcer blocked, so the hash is recomputed from the installed copy.
 */
describe('style-src-attr', () => {
	it("allows the installed SvelteKit announcer's style", () => {
		const root = readFileSync(
			'node_modules/@sveltejs/kit/src/runtime/components/root.svelte',
			'utf8'
		);
		const style = root.match(/id="svelte-announcer"[^>]*?style="([^"]*)"/)?.[1];
		expect(style).toBeDefined();

		const hash = createHash('sha256').update(style!).digest('base64');

		expect(readFileSync('vite.config.ts', 'utf8')).toContain(`'sha256-${hash}'`);
	});
});
