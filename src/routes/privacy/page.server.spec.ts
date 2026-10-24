import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { createTestDatabase, seedUser, type TestDatabase } from '#lib/server/test-db.js';
import { session, watchlistItem } from '#lib/server/db/schema.js';
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

function event(userId: string | null): RequestEvent {
	return {
		request: new Request('http://localhost/privacy', { method: 'POST' }),
		cookies: {},
		locals: { user: userId ? { id: userId, name: 'T', email: 't@e.com', avatarUrl: null } : null }
	} as unknown as RequestEvent;
}

const deleteAccount = (userId: string | null) =>
	(actions.deleteAccount as (e: RequestEvent) => Promise<unknown>)(event(userId));

beforeEach(async () => {
	harness = await createTestDatabase();
	cleared.length = 0;

	await seedUser(harness.db);
	await harness.db.insert(session).values({
		id: 'session-hash',
		userId: 'user-1',
		expiresAt: new Date(Date.now() + 86_400_000)
	});
	await harness.db.insert(watchlistItem).values([
		{ id: 'a', userId: 'user-1', tmdbId: 1, mediaType: 'tv', title: 'Silo' },
		{ id: 'b', userId: 'user-1', tmdbId: 2, mediaType: 'movie', title: 'Arrival' }
	]);
});

const rows = async () => ({
	users: (await harness.db.select().from(schema.user)).length,
	items: (await harness.db.select().from(watchlistItem)).length,
	sessions: (await harness.db.select().from(session)).length
});

describe('deleteAccount', () => {
	it('takes the list and every session with the account', async () => {
		expect(await rows()).toEqual({ users: 1, items: 2, sessions: 1 });

		// The action signals completion by throwing a redirect.
		await expect(deleteAccount('user-1')).rejects.toMatchObject({ status: 303 });

		expect(await rows()).toEqual({ users: 0, items: 0, sessions: 0 });
	});

	it('clears the session cookie, so no token outlives the row', async () => {
		await expect(deleteAccount('user-1')).rejects.toMatchObject({ status: 303 });
		expect(cleared).toEqual(['wl_session']);
	});

	it('leaves other accounts untouched', async () => {
		await seedUser(harness.db, { id: 'user-2', googleId: 'google-2', email: 'b@e.com' });
		await harness.db
			.insert(watchlistItem)
			.values({ id: 'c', userId: 'user-2', tmdbId: 3, mediaType: 'tv', title: 'Andor' });

		await expect(deleteAccount('user-1')).rejects.toMatchObject({ status: 303 });

		expect(await rows()).toEqual({ users: 1, items: 1, sessions: 0 });
	});

	it('does nothing without a session', async () => {
		expect(await deleteAccount(null)).toMatchObject({ status: 401 });
		expect(await rows()).toEqual({ users: 1, items: 2, sessions: 1 });
	});
});
