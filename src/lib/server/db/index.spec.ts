import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

let current: RequestEvent;
vi.mock('$app/server', () => ({ getRequestEvent: () => current }));
vi.mock('./hyperdrive', () => ({
	hyperdriveConnectionString: () => 'postgres://127.0.0.1:54363/postgres'
}));
const { closeDb, getDb } = await import('./index');
const events: RequestEvent[] = [];

function request() {
	const pending: Promise<unknown>[] = [];
	const event = {
		platform: { ctx: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } }
	} as unknown as RequestEvent;
	events.push(event);
	return { event, pending };
}

afterEach(async () => {
	for (const event of events.splice(0)) await closeDb(event);
});

describe('request database lifecycle', () => {
	it('leaves a request that never queries without a client to close', async () => {
		const { event, pending } = request();
		await closeDb(event);
		expect(pending).toEqual([]);
	});

	it('reuses one bounded client within a request and creates another for the next', () => {
		current = request().event;
		const first = getDb();
		expect(getDb()).toBe(first);
		expect(first.$client.options.max).toBe(1);
		expect(first.$client.totalCount).toBe(0);
		current = request().event;
		expect(getDb().$client).not.toBe(first.$client);
	});

	it('schedules disposal through the originating request context only once', async () => {
		const { event, pending } = request();
		current = event;
		const db = getDb();
		const end = vi.spyOn(db.$client, 'end');
		await closeDb(event);
		expect(end).toHaveBeenCalledOnce();
		expect(pending).toHaveLength(1);
		await pending[0];
		await closeDb(event);
		expect(end).toHaveBeenCalledOnce();
	});
});
