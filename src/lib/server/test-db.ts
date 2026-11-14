import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { inject } from 'vitest';
import * as schema from './db/schema';
import type { Database } from './db';
import type { SessionUser } from '#lib/types.js';
import { testDatabaseUrl } from './test-db-setup';
export { watchlistRows as selectWatchlist } from './watchlist/queries';

const ADMIN_SHUTDOWN = '57P01';

export interface TestDatabase {
	db: Database;
	admin: Database;
	close: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
	const name = `nextsode_test_${crypto.randomUUID().replaceAll('-', '')}`;
	const control = new Pool({ connectionString: testDatabaseUrl(), max: 1 });
	const ownerUrl = new URL(testDatabaseUrl());
	ownerUrl.pathname = `/${name}`;
	const appUrl = new URL(ownerUrl);
	appUrl.username = 'nextsode_app';
	appUrl.password = inject('testAppPassword');
	const owner = new Pool({ connectionString: ownerUrl.toString(), max: 1 });
	const app = new Pool({ connectionString: appUrl.toString(), max: 1 });
	// `drop database ... with (force)` can reach a client that `end()` is still
	// closing; its termination notice is expected then, and anything else is not.
	for (const pool of [owner, app]) {
		pool.on('error', (error: Error & { code?: string }) => {
			if (error.code !== ADMIN_SHUTDOWN) throw error;
		});
	}
	try {
		await drizzle(control).execute(
			sql`create database ${sql.identifier(name)} template nextsode_template`
		);
	} catch (error) {
		await Promise.all([app.end(), owner.end(), control.end()]);
		throw error;
	}
	return {
		db: drizzle(app, { schema }),
		admin: drizzle(owner, { schema }),
		close: async () => {
			await Promise.all([app.end(), owner.end()]);
			try {
				await drizzle(control).execute(sql`drop database ${sql.identifier(name)} with (force)`);
			} finally {
				await control.end();
			}
		}
	};
}

export const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001';
export function testUser(id = DEFAULT_USER_ID): SessionUser {
	return { id, name: 'Test User', email: 'test@example.com', avatarUrl: null };
}

export async function seedUser(
	admin: Database,
	over: Partial<typeof schema.user.$inferInsert> = {}
) {
	const [row] = await admin
		.insert(schema.user)
		.values({
			id: DEFAULT_USER_ID,
			googleId: 'google-1',
			email: 'test@example.com',
			name: 'Test User',
			...over
		})
		.returning();
	return row;
}

export type ItemSeed = Partial<Omit<typeof schema.watchlistItem.$inferInsert, 'mediaId'>> &
	Omit<typeof schema.media.$inferInsert, 'id' | 'createdAt' | 'updatedAt'> & { userId: string };

export async function seedMedia(admin: Database, values: typeof schema.media.$inferInsert) {
	const [row] = await admin
		.insert(schema.media)
		.values(values)
		.onConflictDoUpdate({
			target: [schema.media.tmdbId, schema.media.mediaType],
			set: values
		})
		.returning();
	return row;
}

export async function seedItem(admin: Database, values: ItemSeed) {
	const {
		id,
		userId,
		watched,
		seasonsSeen,
		episodesIntoSeason,
		watchedAt,
		addedAt,
		updatedAt,
		...metadata
	} = values;
	const title = await seedMedia(admin, metadata);
	const [row] = await admin
		.insert(schema.watchlistItem)
		.values({
			id,
			userId,
			mediaId: title.id,
			watched,
			seasonsSeen,
			episodesIntoSeason,
			watchedAt,
			addedAt,
			updatedAt
		})
		.returning();
	return {
		...row,
		...metadata,
		totalSeasons: title.totalSeasons,
		airedSeasons: title.airedSeasons,
		nextSeasonNumber: title.nextSeasonNumber,
		nextSeasonAirDate: title.nextSeasonAirDate,
		posterPath: title.posterPath,
		releaseDate: title.releaseDate,
		overview: title.overview,
		voteAverage: title.voteAverage
	};
}

export async function seedItems(admin: Database, values: ItemSeed | ItemSeed[]) {
	const rows = [];
	for (const value of Array.isArray(values) ? values : [values])
		rows.push(await seedItem(admin, value));
	return rows;
}
