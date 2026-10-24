import { detailsUrl, type DetailsQuery } from '#lib/format/details-url.js';
import type { MediaDetails } from '#lib/types.js';

/**
 * One title's details, and the three states fetching them can be in.
 *
 * Kept out of the sheet for the same reason `MediaSearch` and `TrendingFeed`
 * are: the markup stays declarative, and loading / loaded / failed can be
 * reasoned about — and tested — without a browser or a component around them.
 *
 * The sheet refetches when the tracked season changes, not only when the title
 * does, because episodes ride along on the same request.
 */
export class MediaDetailsRequest {
	details = $state<MediaDetails | null>(null);
	loading = $state(true);
	failed = $state(false);

	/**
	 * The request in flight, so a slow answer cannot overwrite a newer one.
	 *
	 * Without this, opening a title and immediately advancing a season races two
	 * requests, and whichever the network returns last wins — which is not
	 * necessarily the one the viewer is now looking at.
	 */
	#pending = 0;

	load = async (request: DetailsQuery): Promise<void> => {
		const ticket = ++this.#pending;

		this.loading = true;
		this.failed = false;
		this.details = null;

		try {
			const response = await fetch(detailsUrl(request));
			if (!response.ok) throw new Error('Request failed');
			const body = (await response.json()) as MediaDetails;

			if (ticket !== this.#pending) return;
			this.details = body;
		} catch {
			if (ticket !== this.#pending) return;
			this.failed = true;
		} finally {
			if (ticket === this.#pending) this.loading = false;
		}
	};
}
