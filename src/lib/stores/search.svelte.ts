import type { MediaResult, PersonResult } from '#lib/types.js';

/** Wait after the last keystroke before hitting the network. */
const DEBOUNCE_MS = 350;

/**
 * Debounced TMDB search, kept out of the page component so the markup stays
 * declarative and the behaviour can be reasoned about on its own.
 */
export class MediaSearch {
	query = $state('');
	results = $state<MediaResult[]>([]);
	/** People matching the same query, shown above the titles. */
	people = $state<PersonResult[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);

	#timer: ReturnType<typeof setTimeout> | undefined;
	#inFlight: AbortController | undefined;

	/** True while the box holds a real query — i.e. show results, not trending. */
	get active(): boolean {
		return this.query.trim().length > 0;
	}

	/** Call on every keystroke; schedules (or cancels) the actual request. */
	onInput = () => {
		clearTimeout(this.#timer);
		const query = this.query.trim();

		if (!query) {
			this.#abort();
			this.results = [];
			this.people = [];
			this.error = null;
			this.loading = false;
			return;
		}

		// Show the skeletons immediately rather than after the debounce, so typing
		// feels responsive even though the request has not started yet.
		this.loading = true;
		this.#timer = setTimeout(() => this.#run(query), DEBOUNCE_MS);
	};

	clear = () => {
		clearTimeout(this.#timer);
		this.#abort();
		this.query = '';
		this.results = [];
		this.people = [];
		this.error = null;
		this.loading = false;
	};

	async #run(query: string) {
		// Cancel whatever is still in flight. Without this, a slow early request
		// could resolve after a later one and overwrite fresher results with
		// answers to a query the user has already moved on from.
		this.#abort();
		const controller = new AbortController();
		this.#inFlight = controller;

		this.loading = true;
		this.error = null;

		try {
			const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
				signal: controller.signal
			});
			if (!response.ok) throw new Error('Search request failed');
			const body = (await response.json()) as { results: MediaResult[]; people: PersonResult[] };
			this.results = body.results;
			this.people = body.people ?? [];
		} catch (err) {
			// An abort is a superseded request, not a failure — leave the UI alone.
			if (err instanceof DOMException && err.name === 'AbortError') return;
			this.error = 'Something went wrong while searching. Please try again.';
			this.results = [];
			this.people = [];
		} finally {
			if (this.#inFlight === controller) {
				this.#inFlight = undefined;
				this.loading = false;
			}
		}
	}

	#abort() {
		this.#inFlight?.abort();
		this.#inFlight = undefined;
	}
}
