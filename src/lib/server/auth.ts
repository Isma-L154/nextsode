import { and, eq, sql } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { getDb } from './db';
import { session } from './db/schema';
import { withUser } from './db/user';
import type { Transaction } from './db';
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
export async function createSession(
	token: string,
	user: SessionUser,
	transaction?: Transaction
): Promise<Date> {
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
	const id = await hashToken(token);
	await withUser(
		user,
		async (tx) => {
			await tx.insert(session).values({ id, userId: user.id, expiresAt });
		},
		transaction
	);
	return expiresAt;
}

export interface ValidatedSession {
	user: SessionUser;
	expiresAt: Date;
	/** True when the expiry was just extended and the cookie should be re-issued. */
	renewed: boolean;
}

async function findSession(id: string) {
	const result = await getDb().execute<{
		user_id: string;
		name: string;
		email: string;
		avatar_url: string | null;
		expires_at: Date | string;
	}>(sql`select * from nextsode.find_session(${id})`);
	const row = result.rows[0];
	if (!row) return null;
	return {
		user: { id: row.user_id, name: row.name, email: row.email, avatarUrl: row.avatar_url },
		expiresAt: new Date(row.expires_at)
	};
}

/**
 * Resolve a cookie to its owner, deleting expired sessions on sight. Fresh
 * sessions take one lookup; only expiry and renewal acquire a transaction.
 */
export async function validateSession(token: string): Promise<ValidatedSession | null> {
	const id = await hashToken(token);
	const found = await findSession(id);
	if (!found) return null;
	const { user, expiresAt } = found;
	if (expiresAt.getTime() <= Date.now()) {
		await withUser(user, async (db) => {
			await db.delete(session).where(and(eq(session.id, id), eq(session.userId, user.id)));
		});
		return null;
	}
	if (expiresAt.getTime() - Date.now() < RENEW_AFTER_MS) {
		const renewedUntil = new Date(Date.now() + SESSION_TTL_MS);
		await withUser(user, async (db) => {
			await db
				.update(session)
				.set({ expiresAt: renewedUntil })
				.where(and(eq(session.id, id), eq(session.userId, user.id)));
		});
		return { user, expiresAt: renewedUntil, renewed: true };
	}
	return { user, expiresAt, renewed: false };
}

/** Revoke a single session (sign out on this device only). */
export async function invalidateSession(token: string): Promise<void> {
	const id = await hashToken(token);
	const found = await findSession(id);
	if (!found) return;
	await withUser(found.user, async (db) => {
		await db.delete(session).where(and(eq(session.id, id), eq(session.userId, found.user.id)));
	});
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
