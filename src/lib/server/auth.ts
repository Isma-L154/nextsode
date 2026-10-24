import { eq } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { getDb } from './db';
import { session, user } from './db/schema';
import type { SessionUser } from '#lib/types.js';

/**
 * Minimal, dependency-free session management.
 *
 * The browser holds an opaque random token in an httpOnly cookie; the database
 * only ever stores its SHA-256 hash. Validating a request therefore costs one
 * indexed primary-key lookup, and a database dump on its own is not enough to
 * impersonate anyone.
 */

export const SESSION_COOKIE = 'wl_session';

/** How long a session stays valid without any activity. */
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/**
 * Sessions are extended lazily: only once they are past their halfway point.
 * This keeps an active user permanently signed in while avoiding a database
 * write on every single request.
 */
const RENEW_AFTER_MS = SESSION_TTL_MS / 2;

/** Generate a 256-bit token — enough entropy to make guessing infeasible. */
export function generateSessionToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return toHex(bytes);
}

/** Create and persist a session for `userId`, returning its expiry. */
export async function createSession(token: string, userId: string): Promise<Date> {
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
	await getDb()
		.insert(session)
		.values({ id: await hashToken(token), userId, expiresAt });
	return expiresAt;
}

export interface ValidatedSession {
	user: SessionUser;
	expiresAt: Date;
	/** True when the expiry was just extended and the cookie should be re-issued. */
	renewed: boolean;
}

/**
 * Resolve a raw cookie token to its owner, or `null` when the session is
 * unknown or expired. Expired rows are deleted on sight so the table stays
 * small without needing a scheduled cleanup job.
 */
export async function validateSession(token: string): Promise<ValidatedSession | null> {
	const id = await hashToken(token);
	const db = getDb();

	const rows = await db
		.select({
			expiresAt: session.expiresAt,
			id: user.id,
			name: user.name,
			email: user.email,
			avatarUrl: user.avatarUrl
		})
		.from(session)
		.innerJoin(user, eq(session.userId, user.id))
		.where(eq(session.id, id))
		.limit(1);

	const row = rows[0];
	if (!row) return null;

	if (row.expiresAt.getTime() <= Date.now()) {
		await db.delete(session).where(eq(session.id, id));
		return null;
	}

	let expiresAt = row.expiresAt;
	let renewed = false;
	if (expiresAt.getTime() - Date.now() < RENEW_AFTER_MS) {
		expiresAt = new Date(Date.now() + SESSION_TTL_MS);
		await db.update(session).set({ expiresAt }).where(eq(session.id, id));
		renewed = true;
	}

	return {
		user: { id: row.id, name: row.name, email: row.email, avatarUrl: row.avatarUrl },
		expiresAt,
		renewed
	};
}

/** Revoke a single session (sign out on this device only). */
export async function invalidateSession(token: string): Promise<void> {
	await getDb()
		.delete(session)
		.where(eq(session.id, await hashToken(token)));
}

/**
 * Write the session cookie.
 *
 * `secure` is intentionally left to SvelteKit, which enables it everywhere
 * except plain-http localhost — so production is always https-only while local
 * development keeps working.
 */
export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date): void {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		// `lax` still sends the cookie on the top-level redirect back from Google,
		// while blocking it on cross-site sub-requests (CSRF protection).
		sameSite: 'lax',
		expires: expiresAt
	});
}

export function deleteSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

async function hashToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
