import type { PersonFilmography } from '#lib/types.js';

/**
 * One cast member's filmography, and the three states fetching it can be in.
 *
 * The same shape as `MediaDetailsRequest` and for the same reasons: the panel
 * stays declarative, and loading / loaded / failed can be reasoned about without
 * a browser around them.
 */
export class PersonRequest {
	person = $state<PersonFilmography | null>(null);
	loading = $state(false);
	failed = $state(false);

	/**
	 * The request in flight, so a slow answer cannot overwrite a newer one.
	 *
	 * Faces sit side by side and are a single tap apart, so racing two lookups is
	 * the normal way to use this rather than an edge case — without the ticket
	 * the panel can settle on whichever person the network happened to return
	 * last.
	 */
	#pending = 0;

	load = async (personId: number): Promise<void> => {
		const ticket = ++this.#pending;

		this.loading = true;
		this.failed = false;
		this.person = null;

		try {
			const response = await fetch(`/api/person/${personId}`);
			if (!response.ok) throw new Error('Request failed');
			const body = (await response.json()) as PersonFilmography;

			if (ticket !== this.#pending) return;
			this.person = body;
		} catch {
			if (ticket !== this.#pending) return;
			this.failed = true;
		} finally {
			if (ticket === this.#pending) this.loading = false;
		}
	};

	/** Abandon whatever is in flight, so a late answer cannot reopen a closed panel. */
	cancel = (): void => {
		this.#pending++;
		this.loading = false;
		this.failed = false;
		this.person = null;
	};
}
