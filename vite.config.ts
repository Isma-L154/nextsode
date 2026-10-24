import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),

			/**
			 * Content Security Policy.
			 *
			 * The app already sent one, but it carried a single directive
			 * (`frame-ancestors`) — enough to stop clickjacking and nothing else. A
			 * policy without `script-src` does not constrain script injection at all,
			 * which is the attack CSP exists for.
			 *
			 * SvelteKit generates the hashes for its own inline hydration script, so
			 * `unsafe-inline` is never needed for scripts. Everything below is an
			 * origin the app genuinely loads from, and nothing else can run.
			 */
			csp: {
				mode: 'hash',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					// Styles stay permissive: Tailwind and Svelte both emit inline
					// style attributes during SSR, and an injected style cannot
					// execute — a far smaller risk than the same allowance on script.
					'style-src': ['self', 'unsafe-inline'],
					// Posters from TMDB, avatars from Google, inline SVG data URIs.
					'img-src': ['self', 'data:', 'https://image.tmdb.org', 'https://*.googleusercontent.com'],
					'font-src': ['self'],
					'connect-src': ['self'],
					// The trailer embed, and nothing else may frame anything.
					'frame-src': ['https://www.youtube-nocookie.com'],
					'frame-ancestors': ['none'],
					'object-src': ['none'],
					'base-uri': ['none'],
					// Sign-out and every list mutation post to this origin; sign-in
					// leaves by redirect, which this does not govern.
					'form-action': ['self']
				}
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						// Wide enough to be past the `sm` breakpoint. Several components
						// deliberately behave differently below it — `ScrollRail` hides
						// its arrows on a phone, where dragging is the gesture — so a
						// narrow default would test the mobile variant while the test
						// name claimed otherwise.
						viewport: { width: 1280, height: 800 },
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**'],
					// Components here are styled entirely with utility classes, so
					// without the stylesheet they mount as unstyled boxes and any
					// layout-dependent assertion is meaningless.
					setupFiles: ['./vitest-setup-client.ts']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
