import type { MediaType } from '$lib/types';

/**
 * The public address of one title, and how to read it back.
 *
 * A shared link is the first thing anyone sees of this app, and it is usually
 * seen as text — pasted into a chat, read aloud, hovered over before it is
 * trusted. So the path says what it points at: `/title/movie/157336-interstellar`
 * rather than an opaque token.
 *
 * The number is the address; the words after it are decoration that can go
 * stale. TMDB renames titles, and a link that stopped working because a film
 * was retitled would be a link that broke in someone's message history months
 * later. The route reads the id and redirects to the current spelling.
 *
 * Nothing here is a secret. A TMDB id is public, identical for every visitor,
 * and reveals nothing about who shared it — which is why these pages need no
 * token, no expiry and no row in the database.
 */

/** Words in the slug. More than this and the URL stops being readable anyway. */
const MAX_SLUG_WORDS = 8;

/**
 * A title reduced to lowercase words joined by hyphens.
 *
 * Accents are decomposed and their combining marks dropped rather than
 * transliterated, so "Amélie" becomes "amelie" — the form someone would type.
 * Everything that is not a letter or a digit becomes a separator, which handles
 * the punctuation film titles are full of: colons, apostrophes, ampersands.
 *
 * A title made entirely of characters this strips — a CJK or Cyrillic one —
 * yields an empty string, and the caller emits the bare id instead. That is
 * correct rather than a gap: percent-encoded UTF-8 in a shared link is noise.
 */
export function slugify(title: string): string {
	return title
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.split('-')
		.slice(0, MAX_SLUG_WORDS)
		.join('-');
}

/** The slug segment for a title: the id, plus its name when it survives slugifying. */
export function titleSlug(tmdbId: number, title: string): string {
	const words = slugify(title);
	return words ? `${tmdbId}-${words}` : String(tmdbId);
}

/** The canonical path for a title, leading slash included. */
export function titlePath(item: { tmdbId: number; mediaType: MediaType; title: string }): string {
	return `/title/${item.mediaType}/${titleSlug(item.tmdbId, item.title)}`;
}

/**
 * The TMDB id a slug segment addresses, or null when it addresses nothing.
 *
 * Only the leading digits are read, so every past spelling of a title keeps
 * resolving. The rejections matter as much as the acceptance: a leading zero
 * (`007-bond`) and a decimal both give two spellings of one id, and letting
 * them through would put duplicate URLs into the index for the same page.
 */
export function parseTitleSlug(slug: string): number | null {
	const digits = /^(0|[1-9][0-9]*)(?:-|$)/.exec(slug)?.[1];
	if (!digits) return null;

	const tmdbId = Number(digits);
	return Number.isSafeInteger(tmdbId) && tmdbId > 0 ? tmdbId : null;
}
