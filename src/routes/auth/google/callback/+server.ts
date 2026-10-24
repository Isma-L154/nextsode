import { redirect } from '@sveltejs/kit';
import { eq, ne, sql } from 'drizzle-orm';
import { createSession, generateSessionToken, setSessionCookie } from '#lib/server/auth.js';
import { getDb } from '#lib/server/db/index.js';
import { user, watchlistItem } from '#lib/server/db/schema.js';
import {
	STATE_COOKIE,
	VERIFIER_COOKIE,
	createGoogleClient,
	fetchGoogleProfile,
	type GoogleProfile
} from '#lib/server/oauth.js';
import type { RequestHandler } from './$types';

/**
 * Placeholder account created by the auth migration to own watchlist rows that
 * predate sign-in. See `claimLegacyItems`.
 */
const LEGACY_OWNER_ID = '__legacy__';

/**
 * Step 2 of the sign-in flow: Google redirects back here with an authorization
 * code, which we exchange for a profile and turn into a local session.
 *
 * Every failure path lands on `/?auth=error` rather than an error page: the
 * visitor can simply press the button again, and no internal detail leaks.
 */
export const GET: RequestHandler = async ({ cookies, url }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const expectedState = cookies.get(STATE_COOKIE);
	const codeVerifier = cookies.get(VERIFIER_COOKIE);

	// Single-use by design: clear the handshake cookies before doing anything
	// else, so a replayed callback URL cannot be validated twice.
	cookies.delete(STATE_COOKIE, { path: '/' });
	cookies.delete(VERIFIER_COOKIE, { path: '/' });

	// A mismatching state means the request did not originate from our own
	// sign-in button — the standard OAuth CSRF check.
	if (!code || !state || !expectedState || !codeVerifier || state !== expectedState) {
		redirect(302, '/?auth=error');
	}

	try {
		const google = createGoogleClient(url.origin);
		const tokens = await google.validateAuthorizationCode(code, codeVerifier);
		const profile = await fetchGoogleProfile(tokens.accessToken());

		const userId = await upsertUser(profile);
		const token = generateSessionToken();
		setSessionCookie(cookies, token, await createSession(token, userId));
	} catch (err) {
		console.error('Google sign-in failed:', err);
		redirect(302, '/?auth=error');
	}

	redirect(302, '/');
};

/**
 * Find the account behind a Google profile, creating it on first sign-in.
 *
 * Name, email and avatar are refreshed on every login so the account chip
 * follows whatever the person currently has on their Google profile.
 */
async function upsertUser(profile: GoogleProfile): Promise<string> {
	const db = getDb();

	const [existing] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.googleId, profile.sub))
		.limit(1);

	if (existing) {
		await db
			.update(user)
			.set({ email: profile.email, name: profile.name, avatarUrl: profile.picture })
			.where(eq(user.id, existing.id));
		return existing.id;
	}

	const [created] = await db
		.insert(user)
		.values({
			googleId: profile.sub,
			email: profile.email,
			name: profile.name,
			avatarUrl: profile.picture
		})
		.returning({ id: user.id });

	await claimLegacyItems(created.id);
	return created.id;
}

/**
 * One-time data migration: hand the pre-accounts watchlist to the very first
 * person who signs in — the owner of the deployment.
 *
 * The migration parked those rows under a placeholder account (rather than a
 * dangling id) so the foreign key stays valid in the meantime. Once they are
 * reassigned the placeholder is deleted and this becomes a permanent no-op.
 */
async function claimLegacyItems(newUserId: string): Promise<void> {
	const db = getDb();

	const [placeholder] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.id, LEGACY_OWNER_ID))
		.limit(1);
	if (!placeholder) return;

	// Only the very first real account inherits the list; later visitors start
	// from an empty one.
	const [{ count }] = await db
		.select({ count: sql<number>`count(*)` })
		.from(user)
		.where(ne(user.id, LEGACY_OWNER_ID));
	if (Number(count) !== 1) return;

	await db
		.update(watchlistItem)
		.set({ userId: newUserId })
		.where(eq(watchlistItem.userId, LEGACY_OWNER_ID));

	// Safe now that nothing references it — the cascade has nothing left to take.
	await db.delete(user).where(eq(user.id, LEGACY_OWNER_ID));
}
