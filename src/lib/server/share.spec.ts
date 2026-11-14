import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, seedUser, seedItems, testUser, type TestDatabase } from './test-db';
import { user } from './db/schema';

/**
 * The shared list's server side, against a real database.
 *
 * This is the part with no session behind it: the visitor has never signed in,
 * and the token in the URL is the only thing deciding whose list comes back.
 * Getting that wrong publishes one person's list to another, so it is tested
 * against a real engine and its real unique index rather than a mock that would
 * agree with whatever was written.
 */

let harness: TestDatabase;
vi.mock('./db', () => ({ getDb: () => harness.db }));

const { generateShareToken, issueShareToken, loadSharedList, revokeShareToken, setShareScope } =
	await import('./share');

async function saveTitle(userId: string, over: Record<string, unknown> = {}) {
	await seedItems(harness.admin, {
		userId,
		tmdbId: 1,
		mediaType: 'movie',
		title: 'Inception',
		...over
	});
}

/** The scope column exactly as stored, so a test can see what a write left. */
async function storedScope(userId: string) {
	const [row] = await harness.admin
		.select({ scope: user.shareScope, token: user.shareToken })
		.from(user)
		.where(eq(user.id, userId));
	return row;
}

beforeEach(async () => {
	harness = await createTestDatabase();
	await seedUser(harness.admin, { name: 'Ismael Leon' });
	await seedUser(harness.admin, {
		id: '00000000-0000-4000-8000-000000000002',
		googleId: 'google-2',
		email: 'other@example.com',
		name: 'Someone Else'
	});
});

describe('generateShareToken', () => {
	it('is 256 bits of hex', () => {
		expect(generateShareToken()).toMatch(/^[0-9a-f]{64}$/);
	});

	it('does not repeat', () => {
		const tokens = new Set(Array.from({ length: 50 }, generateShareToken));
		expect(tokens.size).toBe(50);
	});
});

describe('issueShareToken', () => {
	it('stores the token and the scope it was created with', async () => {
		const token = await issueShareToken(testUser('00000000-0000-4000-8000-000000000001'), 'both');
		expect(await storedScope('00000000-0000-4000-8000-000000000001')).toEqual({
			token,
			scope: 'both'
		});
	});

	// Rolling over is the undo for a URL that went further than intended, so the
	// old one has to stop resolving.
	it('replaces the previous token, breaking every link already sent', async () => {
		const first = await issueShareToken(
			testUser('00000000-0000-4000-8000-000000000001'),
			'toWatch'
		);
		const second = await issueShareToken(
			testUser('00000000-0000-4000-8000-000000000001'),
			'toWatch'
		);

		expect(second).not.toBe(first);
		expect(await loadSharedList(first)).toBeNull();
		expect(await loadSharedList(second)).not.toBeNull();
	});

	it('leaves other accounts alone', async () => {
		await issueShareToken(testUser('00000000-0000-4000-8000-000000000001'), 'both');
		expect(await storedScope('00000000-0000-4000-8000-000000000002')).toEqual({
			token: null,
			scope: null
		});
	});
});

describe('setShareScope', () => {
	// Widening is not a request to break the URL already sent, and narrowing only
	// achieves anything if it is the same URL that starts showing less.
	it('changes what the link shows without changing the link', async () => {
		const token = await issueShareToken(
			testUser('00000000-0000-4000-8000-000000000001'),
			'toWatch'
		);
		await setShareScope(testUser('00000000-0000-4000-8000-000000000001'), 'watched');

		expect((await storedScope('00000000-0000-4000-8000-000000000001'))?.token).toBe(token);
		expect((await loadSharedList(token))?.scope).toBe('watched');
	});
});

describe('revokeShareToken', () => {
	it('stops every copy of the URL resolving', async () => {
		const token = await issueShareToken(testUser('00000000-0000-4000-8000-000000000001'), 'both');
		await revokeShareToken(testUser('00000000-0000-4000-8000-000000000001'));

		expect(await loadSharedList(token)).toBeNull();
	});

	// So a later link starts from the default rather than silently inheriting a
	// wider setting made for a different audience.
	it('clears the scope along with the token', async () => {
		await issueShareToken(testUser('00000000-0000-4000-8000-000000000001'), 'both');
		await revokeShareToken(testUser('00000000-0000-4000-8000-000000000001'));

		expect(await storedScope('00000000-0000-4000-8000-000000000001')).toEqual({
			token: null,
			scope: null
		});
	});
});

describe('loadSharedList', () => {
	it('answers nothing for a token that matches nothing', async () => {
		// A revoked token, a mistyped one and one that never existed are the same
		// answer: saying "revoked" would confirm the URL was once real.
		expect(await loadSharedList('')).toBeNull();
		expect(await loadSharedList('deadbeef')).toBeNull();
	});

	/**
	 * The one that matters. A token belongs to exactly one account, and nothing
	 * from any other account may appear behind it.
	 */
	it('never returns another account’s titles', async () => {
		await saveTitle('00000000-0000-4000-8000-000000000001', { tmdbId: 11, title: 'Mine' });
		await saveTitle('00000000-0000-4000-8000-000000000002', { tmdbId: 22, title: 'Theirs' });

		const token = await issueShareToken(testUser('00000000-0000-4000-8000-000000000001'), 'both');
		const list = await loadSharedList(token);

		expect(list?.items.map((item) => item.title)).toEqual(['Mine']);
	});

	it('shows only the half the scope names', async () => {
		await saveTitle('00000000-0000-4000-8000-000000000001', {
			tmdbId: 11,
			title: 'Still to watch',
			watched: false
		});
		await saveTitle('00000000-0000-4000-8000-000000000001', {
			tmdbId: 22,
			title: 'Seen it',
			watched: true
		});

		const token = await issueShareToken(
			testUser('00000000-0000-4000-8000-000000000001'),
			'toWatch'
		);
		expect((await loadSharedList(token))?.items.map((i) => i.title)).toEqual(['Still to watch']);

		await setShareScope(testUser('00000000-0000-4000-8000-000000000001'), 'watched');
		expect((await loadSharedList(token))?.items.map((i) => i.title)).toEqual(['Seen it']);

		await setShareScope(testUser('00000000-0000-4000-8000-000000000001'), 'both');
		expect((await loadSharedList(token))?.items).toHaveLength(2);
	});

	/**
	 * Counts describe the whole list even when only half of it is shared: "12 to
	 * watch" is the context that makes a shared list legible, and it is a number,
	 * not a title.
	 */
	it('counts both halves regardless of what is shown', async () => {
		await saveTitle('00000000-0000-4000-8000-000000000001', { tmdbId: 11, watched: false });
		await saveTitle('00000000-0000-4000-8000-000000000001', { tmdbId: 22, watched: false });
		await saveTitle('00000000-0000-4000-8000-000000000001', { tmdbId: 33, watched: true });

		const list = await loadSharedList(
			await issueShareToken(testUser('00000000-0000-4000-8000-000000000001'), 'watched')
		);

		expect(list?.counts).toEqual({ toWatch: 2, watched: 1 });
		expect(list?.items).toHaveLength(1);
	});

	// The full name a Google account carries must not leave the server.
	it('reduces the owner to a first name', async () => {
		const list = await loadSharedList(
			await issueShareToken(testUser('00000000-0000-4000-8000-000000000001'), 'both')
		);

		expect(list?.ownerName).toBe('Ismael');
	});

	/**
	 * Nothing on a returned row is a handle on the owner's list. A row id would
	 * be one: item ids travel through forms, and the write actions match on id
	 * *and* owner precisely because knowing one must not be enough to use it.
	 */
	it('carries nothing that identifies the owner or their rows', async () => {
		await saveTitle('00000000-0000-4000-8000-000000000001', { tmdbId: 11 });
		const list = await loadSharedList(
			await issueShareToken(testUser('00000000-0000-4000-8000-000000000001'), 'both')
		);

		expect(Object.keys(list!.items[0]).sort()).toEqual([
			'mediaType',
			'posterPath',
			'releaseDate',
			'title',
			'tmdbId',
			'voteAverage',
			'watched'
		]);
	});

	it('refuses an invalid stored scope without changing the published scope', async () => {
		const token = await issueShareToken(testUser(), 'toWatch');
		await expect(
			harness.admin.update(user).set({ shareScope: 'everything' }).where(eq(user.id, testUser().id))
		).rejects.toMatchObject({ cause: { code: '23514' } });
		await saveTitle(testUser().id, { tmdbId: 11, watched: false });
		await saveTitle(testUser().id, { tmdbId: 22, watched: true });
		const list = await loadSharedList(token);
		expect(list?.scope).toBe('toWatch');
		expect(list?.items).toHaveLength(1);
	});

	it('refuses a share token without a scope', async () => {
		await expect(
			harness.admin
				.update(user)
				.set({ shareToken: 'a'.repeat(64), shareScope: null })
				.where(eq(user.id, testUser().id))
		).rejects.toMatchObject({
			cause: { code: '23514', constraint: 'app_user_share_scope_with_token' }
		});
		expect(await loadSharedList('a'.repeat(64))).toBeNull();
	});

	it('survives an account with an empty list', async () => {
		const list = await loadSharedList(
			await issueShareToken(testUser('00000000-0000-4000-8000-000000000001'), 'both')
		);

		expect(list?.items).toEqual([]);
		expect(list?.counts).toEqual({ toWatch: 0, watched: 0 });
	});
});

afterEach(async () => {
	await harness?.close();
});
