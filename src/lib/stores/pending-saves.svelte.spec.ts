import type { SubmitFunction } from '$app/forms';
import { describe, expect, it, vi } from 'vitest';
import { JUST_SAVED, optimistic, pendingSaves } from './pending-saves.svelte';
import type { SavedEntry } from '$lib/types';

const entry = (id: string): SavedEntry => ({
	id,
	watched: false,
	seasonsSeen: 0,
	episodesIntoSeason: 0,
	totalSeasons: null,
	airedSeasons: null
});

/**
 * Every test claims its own key. The store is a module singleton on purpose —
 * that is what lets a grid, a rail and the open sheet agree about one title —
 * so sharing a key between tests would share their state too.
 */
let next = 0;
const freshKey = () => `${++next}:movie`;

/**
 * Stand-in for the parts of `use:enhance` this code touches. `cancel` records
 * rather than throws, because a cancelled submit is a normal outcome here: it
 * is what a double tap is supposed to produce.
 */
function submitInput() {
	const cancel = vi.fn();
	return { cancel, input: { cancel } as never };
}

describe('pendingSaves', () => {
	it('leaves the loader index untouched when nothing is in flight', () => {
		const saved = { '1:movie': entry('a') };

		// Identity, not just equality: every `$derived` downstream of this keeps
		// its value when no save is pending, which is nearly always.
		expect(pendingSaves.overlay(saved)).toBe(saved);
	});

	it('lays a pending save over the index', () => {
		const key = freshKey();
		pendingSaves.claim(key, JUST_SAVED);

		expect(pendingSaves.overlay({})[key]).toEqual(JUST_SAVED);

		pendingSaves.settle(key);
	});

	it('takes a pending removal out of the index', () => {
		const key = freshKey();
		const saved = { [key]: entry('a') };
		pendingSaves.claim(key, null);

		expect(key in pendingSaves.overlay(saved)).toBe(false);
		expect(pendingSaves.removed(key)).toBe(true);

		pendingSaves.settle(key);
	});

	it('does not copy the loader index it was given', () => {
		const key = freshKey();
		const saved = { [key]: entry('a') };
		pendingSaves.claim(key, null);
		pendingSaves.overlay(saved);

		// The overlay is a view. Mutating the loader's own object would outlive
		// the request and survive into data that is meant to replace it.
		expect(saved[key]).toEqual(entry('a'));

		pendingSaves.settle(key);
	});

	it('hands the key back on settle', () => {
		const key = freshKey();
		pendingSaves.claim(key, null);
		pendingSaves.settle(key);

		expect(pendingSaves.pending(key)).toBe(false);
		expect(pendingSaves.removed(key)).toBe(false);
		expect(pendingSaves.overlay({ [key]: entry('a') })[key]).toEqual(entry('a'));
	});

	it('refuses a second claim on a key already in flight', () => {
		const key = freshKey();

		expect(pendingSaves.claim(key, JUST_SAVED)).toBe(true);
		expect(pendingSaves.claim(key, null)).toBe(false);
		// The loser must not have moved the state it lost.
		expect(pendingSaves.overlay({})[key]).toEqual(JUST_SAVED);

		pendingSaves.settle(key);
	});

	it('tells a removal apart from a save and from an untouched title', () => {
		const untouched = freshKey();
		const removing = freshKey();
		const saving = freshKey();

		pendingSaves.claim(removing, null);
		pendingSaves.claim(saving, JUST_SAVED);

		expect(pendingSaves.removed(removing)).toBe(true);
		// The discriminator: a save is just as pending as a removal, and My List
		// hides a tile on `removed` alone. Reading one as the other would make a
		// title vanish from the grid at the moment it was added to it.
		expect(pendingSaves.pending(saving)).toBe(true);
		expect(pendingSaves.removed(saving)).toBe(false);
		expect(pendingSaves.removed(untouched)).toBe(false);

		pendingSaves.settle(removing);
		pendingSaves.settle(saving);
	});
});

describe('optimistic', () => {
	it('claims the key before the request goes out', async () => {
		const key = freshKey();
		const { input } = submitInput();

		await optimistic(key, JUST_SAVED, (() => {}) as SubmitFunction)(input);

		expect(pendingSaves.overlay({})[key]).toEqual(JUST_SAVED);

		pendingSaves.settle(key);
	});

	it('holds the override until the fresh data has landed', async () => {
		const key = freshKey();
		const { input } = submitInput();
		const seenDuringUpdate: boolean[] = [];

		const done = await optimistic(key, JUST_SAVED, (() => {}) as SubmitFunction)(input);
		await done?.({
			update: async () => {
				// Settling here instead would drop the card back to its old state for
				// a frame before the new data arrived — the flicker this exists to
				// avoid.
				seenDuringUpdate.push(pendingSaves.pending(key));
			}
		} as never);

		expect(seenDuringUpdate).toEqual([true]);
		expect(pendingSaves.pending(key)).toBe(false);
	});

	it('runs the wrapped handler and settles after it', async () => {
		const key = freshKey();
		const { input } = submitInput();
		const order: string[] = [];

		const then: SubmitFunction = () => async () => {
			order.push(pendingSaves.pending(key) ? 'handler: still pending' : 'handler: settled');
		};

		const done = await optimistic(key, null, then)(input);
		await done?.({} as never);

		expect(order).toEqual(['handler: still pending']);
		expect(pendingSaves.pending(key)).toBe(false);
	});

	it('gives the key back when the request fails', async () => {
		const key = freshKey();
		const { input } = submitInput();
		const saved = { [key]: entry('a') };

		const then: SubmitFunction = () => async () => {
			throw new Error('network');
		};

		const done = await optimistic(key, null, then)(input);
		await expect(done?.({} as never)).rejects.toThrow('network');

		// Reverted: the title is back, and it is pressable again. A key left
		// claimed would strand the card looking removed for the rest of the visit.
		expect(pendingSaves.pending(key)).toBe(false);
		expect(pendingSaves.overlay(saved)[key]).toEqual(entry('a'));
	});

	it('cancels a second submit for the same title', async () => {
		const key = freshKey();
		const first = submitInput();
		const second = submitInput();
		const then = vi.fn((() => {}) as SubmitFunction);

		await optimistic(key, JUST_SAVED, then)(first.input);
		const done = await optimistic(key, JUST_SAVED, then)(second.input);

		expect(first.cancel).not.toHaveBeenCalled();
		expect(second.cancel).toHaveBeenCalledTimes(1);
		// Cancelled outright: no handler was built, so nothing runs after it and
		// no second write leaves the browser.
		expect(then).toHaveBeenCalledTimes(1);
		expect(done).toBeUndefined();

		pendingSaves.settle(key);
	});

	it('lets the same title be saved again once the first request has settled', async () => {
		const key = freshKey();
		const { input } = submitInput();

		const done = await optimistic(key, JUST_SAVED, (() => {}) as SubmitFunction)(input);
		await done?.({ update: async () => {} } as never);

		const again = submitInput();
		await optimistic(key, null, (() => {}) as SubmitFunction)(again.input);

		expect(again.cancel).not.toHaveBeenCalled();
		expect(pendingSaves.removed(key)).toBe(true);

		pendingSaves.settle(key);
	});
});
