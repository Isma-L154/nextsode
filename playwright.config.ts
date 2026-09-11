import { defineConfig } from '@playwright/test';

/**
 * E2E runs against the dev server so it picks up local `.env` (TMDB token +
 * database). Because it needs those secrets, e2e is a local/manual step and is
 * intentionally not part of the CI workflow.
 */

/**
 * A port of this suite's own, deliberately not Vite's default.
 *
 * On 5173 the suite once ran end to end against somebody else's application:
 * another Vite project had taken the default port first, `reuseExistingServer`
 * adopted it without checking whose it was, and all seventeen tests failed
 * against a stranger's HTML — including the ones about `robots.txt` and
 * security headers, which pointed nowhere near the truth. The dangerous
 * direction is the other one: a reused server running stale code can report
 * green for a failure that is really there.
 *
 * A port nothing else defaults to is what removes that collision. `--strictPort`
 * closes the second half of it — without it Vite answers a busy port by quietly
 * moving to the next one, and the suite would then be pointed at nothing.
 */
const PORT = 5273;

export default defineConfig({
	testMatch: '**/*.e2e.{ts,js}',
	use: { baseURL: `http://localhost:${PORT}` },
	webServer: {
		command: `npm run dev -- --port ${PORT} --strictPort`,
		port: PORT,
		// Kept for local re-runs, which are otherwise a fresh server every time.
		// It is safe here in a way it was not on 5173: nothing but this suite ever
		// listens on this port, so the server being reused is always our own.
		reuseExistingServer: !process.env.CI
	}
});
