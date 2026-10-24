import type { ActionResult } from '$app/forms';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { absorb, withToast } from './feedback';
import { toasts } from '$lib/stores/toasts.svelte';

beforeEach(() => {
	toasts.items.length = 0;
});

const messages = () => toasts.items.map((toast) => `${toast.type}: ${toast.message}`);

describe('absorb', () => {
	it('takes the fresh data and the payload when the action worked', async () => {
		const update = vi.fn(async () => {});
		const result: ActionResult = { type: 'success', status: 200, data: { added: true } };

		expect(await absorb(result, update)).toEqual({ added: true });
		expect(update).toHaveBeenCalledOnce();
		expect(messages()).toEqual([]);
	});

	it('answers an empty payload for an action that returns nothing', async () => {
		const result: ActionResult = { type: 'success', status: 200, data: undefined };

		// `{}` rather than `null`: it succeeded, and a caller reading fields off it
		// should get "nothing there", not "it failed".
		expect(await absorb(result, async () => {})).toEqual({});
	});

	it('refreshes and complains when the server declines on purpose', async () => {
		const update = vi.fn(async () => {});
		const result: ActionResult = { type: 'failure', status: 400, data: { message: 'nope' } };

		expect(await absorb(result, update)).toBeNull();
		// The connection worked, so whatever else changed while we asked is worth
		// having.
		expect(update).toHaveBeenCalledOnce();
		expect(messages()).toEqual(['error: Something went wrong']);
	});

	it('does not refresh when there was no answer at all', async () => {
		const update = vi.fn(async () => {});
		const result: ActionResult = { type: 'error', error: new Error('offline') };

		expect(await absorb(result, update)).toBeNull();
		// `update` would hand this to `applyAction`, which replaces the page with
		// the error boundary — losing the visitor's search, their scroll and any
		// open sheet because a background request failed. A toast says the same.
		expect(update).not.toHaveBeenCalled();
		expect(messages()).toEqual(['error: Something went wrong']);
	});

	it('says nothing about a redirect, which speaks for itself', async () => {
		const update = vi.fn(async () => {});
		const result: ActionResult = { type: 'redirect', status: 303, location: '/' };

		expect(await absorb(result, update)).toBeNull();
		expect(update).toHaveBeenCalledOnce();
		expect(messages()).toEqual([]);
	});
});

describe('withToast', () => {
	const run = async (
		result: ActionResult,
		message = 'Added “Solaris”',
		type?: 'success' | 'info'
	) => {
		const submit = type ? withToast(message, type) : withToast(message);
		const handler = await submit({} as never);
		await handler?.({ result, update: async () => {} } as never);
	};

	it('announces the message the caller wrote, only on success', async () => {
		await run({ type: 'success', status: 200, data: undefined });
		expect(messages()).toEqual(['success: Added “Solaris”']);
	});

	it('carries the caller’s tone through', async () => {
		await run({ type: 'success', status: 200, data: undefined }, 'Removed “Solaris”', 'info');
		expect(messages()).toEqual(['info: Removed “Solaris”']);
	});

	it('does not claim success when the action failed', async () => {
		await run({ type: 'failure', status: 400, data: undefined });
		expect(messages()).toEqual(['error: Something went wrong']);
	});

	it('does not claim success when the request never landed', async () => {
		await run({ type: 'error', error: new Error('offline') });
		expect(messages()).toEqual(['error: Something went wrong']);
	});
});
