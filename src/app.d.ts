// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { SessionUser } from '#lib/types.js';

declare global {
	namespace App {
		interface Locals {
			/** The signed-in user, resolved from the session cookie in hooks.server.ts. */
			user: SessionUser | null;
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
	}
}

export {};
