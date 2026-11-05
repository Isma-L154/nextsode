import { mediaKey, uniqueBy, type Identifiable } from './media';
import type { MediaResult } from '../types';

/**
 * Which title pages a search engine should be pointed at.
 *
 * Shared by the title page and the sitemap so the two cannot disagree: a URL
 * the sitemap submits has to be one the page lets into the index, or Search
 * Console reports it as "submitted URL marked noindex".
 */

/** How many related titles a page links to. */
const RELATED_LIMIT = 12;

/**
 * A page with neither a synopsis nor a poster says nothing of its own, and
 * near-empty pages weigh down how a crawler rates the whole site.
 */
export function isThinTitle(title: {
	overview: string | null;
	posterPath: string | null;
}): boolean {
	return !title.overview?.trim() && !title.posterPath;
}

/**
 * The "More like this" row: posters only, the title itself left out, each
 * title once. A tile without a poster is a grey box with a name, which is no
 * reason to follow it.
 */
export function relatedTitles(items: readonly MediaResult[], self: Identifiable): MediaResult[] {
	const selfKey = mediaKey(self);
	const candidates = items.filter((item) => item.posterPath && mediaKey(item) !== selfKey);
	return uniqueBy(candidates, mediaKey).slice(0, RELATED_LIMIT);
}
