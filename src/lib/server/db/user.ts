import { sql } from 'drizzle-orm';
import type { SessionUser } from '#lib/types.js';
import { getDb, type Database, type Transaction } from './index';

/** Identity lasts only for this transaction, including on a pooled connection. */
export function withUser<T>(
	user: SessionUser,
	work: (tx: Transaction) => Promise<T>,
	database: Pick<Database, 'transaction'> = getDb()
): Promise<T> {
	return database.transaction(async (tx) => {
		await tx.execute(sql`select set_config('nextsode.user_id', ${user.id}, true)`);
		return work(tx);
	});
}
