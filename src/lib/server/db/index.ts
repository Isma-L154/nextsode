import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';
import { DATABASE_URL, DATABASE_AUTH_TOKEN } from '$app/env/private';

/**
 * The Drizzle client is created lazily on first use rather than at module load.
 *
 * On Cloudflare Workers, environment variables (via `$env/dynamic/private`) are
 * only populated inside a request context. Reading them at module top level
 * would return `undefined` during the worker's initial evaluation and crash
 * every route, so initialization is deferred until the first query in a request.
 */
let database: LibSQLDatabase<typeof schema> | undefined;

export function getDb(): LibSQLDatabase<typeof schema> {
	if (database) return database;

	// A remote libSQL/Turso database requires an auth token, while a local SQLite
	// file used during development does not.
	const isRemote = DATABASE_URL.startsWith('libsql://');
	if (isRemote && !DATABASE_AUTH_TOKEN) {
		throw new Error('DATABASE_AUTH_TOKEN is required for remote libSQL databases');
	}

	const client = createClient({
		url: DATABASE_URL,
		authToken: DATABASE_AUTH_TOKEN || undefined
	});
	database = drizzle(client, { schema });
	return database;
}
