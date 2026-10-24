import type { SubmitFunction } from '$app/forms';
import type { SavedEntry } from '$lib/types';

/**
 * Saved-state changes that have been asked for but not yet answered.
 *
 * The saved index is the loader's to own — it comes back from the database on
 * every navigation and every invalidation, and a second copy of it in the
 * browser would be a second truth free to drift from the first. So this is not
 * a copy: it is a thin layer of *intent* laid over the loader's data and torn
 * down the moment real data replaces it. A key is in here only while its
 * request is in flight, which is measured in hundreds of milliseconds.
 *
 * Keys are `mediaKey` strings, so a title flips everywhere it is on screen at
 * once — the trending grid, a recommendation rail and the open detail sheet
 * can all be showing the same title, and only one of them was clicked.
 */
class PendingSaves {
	/**
	 * Key → the state the visitor asked for. `null` means "removed".
	 *
	 * `null` is a value here and absence is not: `key in pending` is what
	 * separates "asked to remove this" from "never touched it".
	 */
	#pending = $state<Record<string, SavedEntry | null>>({});

	/** True while a request for this title is still out. */
	pending(key: string): boolean {
		return key in this.#pending;
	}

	/** True while this title is being removed — it should already look gone. */
	removed(key: string): boolean {
		return key in this.#pending && this.#pending[key] === null;
	}

	/**
	 * Take the key, if it is free.
	 *
	 * Returns `false` when a request for the same title is already out, which is
	 * what stops a double tap from becoming two writes. The controls go inert as
	 * soon as a key is claimed, so this is the backstop rather than the guard —
	 * but a submit can still be provoked by the keyboard, or by a second control
	 * for the same title elsewhere on the page.
	 */
	claim(key: string, next: SavedEntry | null): boolean {
		if (this.pending(key)) return false;
		this.#pending[key] = next;
		return true;
	}

	/** Hand the key back to the loader's data, whatever that now says. */
	settle(key: string): void {
		delete this.#pending[key];
	}

	/**
	 * The saved index as it should be drawn: the loader's, with intent on top.
	 *
	 * Returns the original object untouched when nothing is pending — which is
	 * almost always — so the common case allocates nothing and every `$derived`
	 * downstream keeps its identity.
	 */
	overlay(saved: Record<string, SavedEntry>): Record<string, SavedEntry> {
		const keys = Object.keys(this.#pending);
		if (keys.length === 0) return saved;

		const next = { ...saved };
		for (const key of keys) {
			const entry = this.#pending[key];
			if (entry) next[key] = entry;
			else delete next[key];
		}
		return next;
	}
}

export const pendingSaves = new PendingSaves();

/**
 * What a title looks like the instant it is saved, before the server replies.
 *
 * None of this is a guess. A title cannot be watched, or part-way through a
 * season, in the moment it is added — the server will compute season counts
 * from TMDB, and until it does there is genuinely nothing to show. The id is
 * the one field we do not know, and it is why the controls stay inert while a
 * save is pending: `remove` posts an id, and this one would not match a row.
 */
export const JUST_SAVED: SavedEntry = {
	id: '',
	watched: false,
	seasonsSeen: 0,
	episodesIntoSeason: 0,
	totalSeasons: null,
	airedSeasons: null
};

/**
 * Wrap a form submission so the change shows before the network answers.
 *
 * The order at the end is the whole point: `settle` runs *after* the wrapped
 * handler has awaited `update()`, so the override is dropped only once the
 * loader's data already says the same thing. Dropping it first would flash the
 * old state back for a frame — which is the flicker this is meant to avoid.
 *
 * `finally` rather than the happy path, because a rejected request has to give
 * the key back too. Otherwise the title would be stuck looking saved forever.
 */
export function optimistic(
	key: string,
	next: SavedEntry | null,
	then: SubmitFunction
): SubmitFunction {
	return async (input) => {
		if (!pendingSaves.claim(key, next)) return input.cancel();

		const after = await then(input);
		return async (options) => {
			try {
				// A submit function that returns nothing is asking for SvelteKit's
				// default behaviour, which is exactly this.
				if (after) await after(options);
				else await options.update();
			} finally {
				pendingSaves.settle(key);
			}
		};
	};
}
