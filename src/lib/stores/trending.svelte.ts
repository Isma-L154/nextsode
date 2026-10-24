import type { MediaResult } from '#lib/types.js';

/**
 * Incremental paging over the trending list.
 *
 * Page 1 arrives server-rendered with the document; this owns everything after
 * it. Kept out of the page component for the same reason `MediaSearch` is —
 * the markup stays declarative, and the loading/exhausted/failed states can be
 * reasoned about on their own.
 *
 * Deliberately does *not* deduplicate: the view merges these pages with a page 1
 * that reloads independently, so it is the only place that can see the whole
 * list. Two dedupe passes would mean two things to keep in agreement.
 */
export class TrendingFeed {
	/** Pages 2..n, appended in order. Page 1 stays owned by the server load. */
	extra = $state<MediaResult[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);

	#nextPage = $state(2);
	#hasMore = $state(true);

	/** @param hasMore Whether TMDB reported another page after the first. */
	constructor(hasMore: boolean) {
		this.#hasMore = hasMore;
	}

	/** False once TMDB runs out of pages, so the button can retire itself. */
	get hasMore(): boolean {
		return this.#hasMore;
	}

	loadMore = async () => {
		if (this.loading || !this.#hasMore) return;

		this.loading = true;
		this.error = null;

		try {
			const response = await fetch(`/api/trending?page=${this.#nextPage}`);
			if (!response.ok) throw new Error('Request failed');

			const body = (await response.json()) as { results: MediaResult[]; hasMore: boolean };

			this.extra = [...this.extra, ...body.results];
			this.#hasMore = body.hasMore;
			this.#nextPage += 1;
		} catch {
			// The page number is not advanced, so the button doubles as a retry.
			this.error = "Couldn't load more titles. Please try again.";
		} finally {
			this.loading = false;
		}
	};
}
