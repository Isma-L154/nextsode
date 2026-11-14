import { getRequestEvent } from '$app/server';
import type { RequestEvent } from '@sveltejs/kit';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { hyperdriveConnectionString } from './hyperdrive';

export type Database = NodePgDatabase<typeof schema> & { $client: Pool };
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

// A Worker cannot reuse a connection's I/O from a different request.
const requests = new WeakMap<RequestEvent, { db: Database; pool: Pool }>();

export function getDb(): Database {
	const event = getRequestEvent();
	const existing = requests.get(event);
	if (existing) return existing.db;
	const pool = new Pool({ connectionString: hyperdriveConnectionString(), max: 1 });
	const db = drizzle(pool, { schema });
	requests.set(event, { db, pool });
	return db;
}

export async function closeDb(event: RequestEvent): Promise<void> {
	const connection = requests.get(event);
	if (!connection) return;
	requests.delete(event);
	const closing = connection.pool.end();
	if (event.platform?.ctx) event.platform.ctx.waitUntil(closing);
	else await closing;
}
