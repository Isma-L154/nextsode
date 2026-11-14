import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import {
	createTestDatabase,
	seedUser,
	seedItems,
	selectWatchlist,
	type TestDatabase
} from '#lib/server/test-db.js';
import { session } from '#lib/server/db/schema.js';
import * as schema from '#lib/server/db/schema.js';

/**
 * Deleting an account, against a real database.
 *
 * The claim the privacy page makes is that one action removes everything, and
 * the only way to know that is a schema that actually enforces the cascades. A
 * mock would happily report success while leaving a table behind.
 */

let harness: TestDatabase;
const cleared: string[] = [];

vi.mock('#lib/server/db/index.js', () => ({ getDb: () => harness.db }));
vi.mock('#lib/server/auth.js', () => ({
	deleteSessionCookie: () => cleared.push('wl_session')
}));

const { actions } = await import('./+page.server');

function event(userId: string | null, form: Record<string, string>): RequestEvent {
	return {
		request: new Request('http://localhost/privacy', {
			method: 'POST',
			body: new URLSearchParams(form)
		}),
		cookies: {},
		locals: { user: userId ? { id: userId, name: 'T', email: 't@e.com', avatarUrl: null } : null }
	} as unknown as RequestEvent;
}

const deleteAccount = (userId: string | null, form: Record<string, string> = { confirm: 'on' }) =>
	(actions.deleteAccount as (e: RequestEvent) => Promise<unknown>)(event(userId, form));

beforeEach(async () => {
	harness = await createTestDatabase();
	cleared.length = 0;

	await seedUser(harness.admin);
	await harness.admin.insert(session).values({
		id: 'da2787b5a4e142da71ea26fa6fa1ee8d1960c85301b9355e1ff8995d7f44650f',
		userId: '00000000-0000-4000-8000-000000000001',
		expiresAt: new Date(Date.now() + 86_400_000)
	});
	await seedItems(harness.admin, [
		{
			id: '00000000-0000-4000-8000-000000000009',
			userId: '00000000-0000-4000-8000-000000000001',
			tmdbId: 1,
			mediaType: 'tv',
			title: 'Silo'
		},
		{
			id: '00000000-0000-4000-8000-000000000010',
			userId: '00000000-0000-4000-8000-000000000001',
			tmdbId: 2,
			mediaType: 'movie',
			title: 'Arrival'
		}
	]);
});

const rows = async () => ({
	users: (await harness.admin.select().from(schema.user)).length,
	items: (await selectWatchlist(harness.admin)).length,
	sessions: (await harness.admin.select().from(session)).length
});

describe('deleteAccount', () => {
	it('takes the list and every session with the account', async () => {
		expect(await rows()).toEqual({ users: 1, items: 2, sessions: 1 });

		// The action signals completion by throwing a redirect.
		await expect(deleteAccount('00000000-0000-4000-8000-000000000001')).rejects.toMatchObject({
			status: 303
		});

		expect(await rows()).toEqual({ users: 0, items: 0, sessions: 0 });
		expect(await harness.admin.select().from(schema.media)).toHaveLength(2);
	});

	it('clears the session cookie, so no token outlives the row', async () => {
		await expect(deleteAccount('00000000-0000-4000-8000-000000000001')).rejects.toMatchObject({
			status: 303
		});
		expect(cleared).toEqual(['wl_session']);
	});

	it('leaves other accounts untouched', async () => {
		await seedUser(harness.admin, {
			id: '00000000-0000-4000-8000-000000000002',
			googleId: 'google-2',
			email: 'b@e.com'
		});
		await seedItems(harness.admin, {
			id: '00000000-0000-4000-8000-000000000011',
			userId: '00000000-0000-4000-8000-000000000002',
			tmdbId: 3,
			mediaType: 'tv',
			title: 'Andor'
		});

		await expect(deleteAccount('00000000-0000-4000-8000-000000000001')).rejects.toMatchObject({
			status: 303
		});

		expect(await rows()).toEqual({ users: 1, items: 1, sessions: 0 });
	});

	it('does nothing unless the confirmation box was ticked', async () => {
		expect(await deleteAccount('00000000-0000-4000-8000-000000000001', {})).toMatchObject({
			status: 400
		});
		expect(await rows()).toEqual({ users: 1, items: 2, sessions: 1 });
	});

	it('does nothing without a session', async () => {
		expect(await deleteAccount(null)).toMatchObject({ status: 401 });
		expect(await rows()).toEqual({ users: 1, items: 2, sessions: 1 });
	});
});

afterEach(async () => {
	await harness?.close();
});
