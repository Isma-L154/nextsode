import { createClient, type Row } from '@libsql/client';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../src/lib/server/db/schema.ts';

class CopyError extends Error {}

function required(name: string): string {
	const value = process.env[name];
	if (!value) throw new CopyError(`${name} is required`);
	return value;
}

function text(row: Row, column: string): string {
	const value = row[column];
	if (typeof value !== 'string') throw new CopyError(`Expected text in ${column}`);
	return value;
}
function nullableText(row: Row, column: string): string | null {
	return row[column] === null || row[column] === '' ? null : text(row, column);
}
function number(row: Row, column: string): number {
	const value = row[column];
	if (typeof value !== 'number' || !Number.isFinite(value))
		throw new CopyError(`Expected a number in ${column}`);
	return value;
}
function nullableNumber(row: Row, column: string): number | null {
	return row[column] === null ? null : number(row, column);
}
function sourceMediaType(row: Row): 'movie' | 'tv' {
	const value = text(row, 'media_type');
	if (value !== 'movie' && value !== 'tv') throw new CopyError('A source media type is invalid');
	return value;
}
function timestamp(row: Row, column: string): Date {
	return new Date(number(row, column) * 1000);
}
function uuid(value: string): string {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
		? value
		: crypto.randomUUID();
}

async function copy() {
	const sourceUrl = required('TURSO_DATABASE_URL');
	const authToken = required('TURSO_AUTH_TOKEN');
	const targetUrl = required('TARGET_DATABASE_URL');
	const source = createClient({ url: sourceUrl, authToken });
	const pgClient = new Client({ connectionString: targetUrl });
	const db = drizzle(pgClient, { schema });
	const userIds = new Map<string, string>();
	const mediaIds = new Map<string, string>();
	const ownerId = (row: Row) => {
		const id = userIds.get(text(row, 'user_id'));
		if (!id) throw new CopyError('A source row has no account');
		return id;
	};
	let snapshot;
	try {
		await pgClient.connect();
		snapshot = await source.transaction('read');
		const reader = snapshot;
		// Paging stays inside a source snapshot; no personal-data export touches disk.
		async function* pages(query: string) {
			for (let offset = 0; ; offset += 500) {
				const result = await reader.execute({ sql: query, args: [500, offset] });
				if (!result.rows.length) return;
				yield result.rows;
			}
		}
		const counts = {
			users: Number((await reader.execute('select count(*) as total from user')).rows[0].total),
			sessions: Number(
				(await reader.execute('select count(*) as total from session')).rows[0].total
			),
			items: Number(
				(await reader.execute('select count(*) as total from watchlist_item')).rows[0].total
			),
			media: Number(
				(
					await reader.execute(
						'select count(*) as total from (select tmdb_id, media_type from watchlist_item group by tmdb_id, media_type)'
					)
				).rows[0].total
			)
		};
		await db.transaction(async (tx) => {
			await tx.execute(sql`lock table ${schema.user} in access exclusive mode`);
			const [existing] = await tx.select({ total: sql<string>`count(*)` }).from(schema.user);
			if (Number(existing.total) !== 0)
				throw new CopyError('Target nextsode.app_user is not empty; refusing to copy');
			for await (const rows of pages('select * from user order by id limit ? offset ?')) {
				const users = rows.map((row) => {
					const id = uuid(text(row, 'id'));
					userIds.set(text(row, 'id'), id);
					const createdAt = timestamp(row, 'created_at');
					return {
						id,
						googleId: text(row, 'google_id'),
						email: text(row, 'email'),
						name: text(row, 'name'),
						avatarUrl: nullableText(row, 'avatar_url'),
						autoDeleteDays: nullableNumber(row, 'auto_delete_days'),
						calendarToken: nullableText(row, 'calendar_token'),
						shareToken: nullableText(row, 'share_token'),
						shareScope: nullableText(row, 'share_scope'),
						createdAt: createdAt,
						updatedAt: createdAt
					};
				});
				await tx.insert(schema.user).values(users);
			}
			for await (const rows of pages(`select * from (
    select *, row_number() over (partition by tmdb_id, media_type order by added_at desc, id desc) as rank
    from watchlist_item
   ) where rank = 1 order by tmdb_id, media_type limit ? offset ?`)) {
				const titles = rows.map((row) => {
					const id = crypto.randomUUID();
					mediaIds.set(`${number(row, 'tmdb_id')}:${text(row, 'media_type')}`, id);
					const createdAt = timestamp(row, 'added_at');
					return {
						id,
						tmdbId: number(row, 'tmdb_id'),
						mediaType: sourceMediaType(row),
						title: text(row, 'title'),
						posterPath: nullableText(row, 'poster_path'),
						releaseDate: nullableText(row, 'release_date'),
						overview: nullableText(row, 'overview'),
						voteAverage: nullableNumber(row, 'vote_average'),
						totalSeasons: nullableNumber(row, 'total_seasons'),
						airedSeasons: nullableNumber(row, 'aired_seasons'),
						nextSeasonNumber: nullableNumber(row, 'next_season_number'),
						nextSeasonAirDate: nullableText(row, 'next_season_air_date'),
						createdAt: createdAt,
						updatedAt: createdAt
					};
				});
				await tx.insert(schema.media).values(titles);
			}
			for await (const rows of pages('select * from watchlist_item order by id limit ? offset ?')) {
				const items = rows.map((row) => {
					const mediaId = mediaIds.get(`${number(row, 'tmdb_id')}:${text(row, 'media_type')}`);
					if (!mediaId) throw new CopyError('A source item has no media');
					const watched = number(row, 'watched');
					if (watched !== 0 && watched !== 1)
						throw new CopyError('A source watched flag is not 0 or 1');
					const addedAt = timestamp(row, 'added_at');
					return {
						id: uuid(text(row, 'id')),
						userId: ownerId(row),
						mediaId: mediaId,
						watched: watched === 1,
						seasonsSeen: number(row, 'seasons_seen'),
						episodesIntoSeason: number(row, 'episodes_into_season'),
						watchedAt: row.watched_at === null ? null : timestamp(row, 'watched_at'),
						addedAt: addedAt,
						updatedAt: addedAt
					};
				});
				await tx.insert(schema.watchlistItem).values(items);
			}
			for await (const rows of pages('select * from session order by id limit ? offset ?')) {
				const sessions = rows.map((row) => ({
					id: text(row, 'id'),
					userId: ownerId(row),
					expiresAt: timestamp(row, 'expires_at')
				}));
				await tx.insert(schema.session).values(sessions);
			}
			const copied = {
				users: Number(
					(await tx.select({ total: sql<string>`count(*)` }).from(schema.user))[0].total
				),
				sessions: Number(
					(await tx.select({ total: sql<string>`count(*)` }).from(schema.session))[0].total
				),
				items: Number(
					(await tx.select({ total: sql<string>`count(*)` }).from(schema.watchlistItem))[0].total
				),
				media: Number(
					(await tx.select({ total: sql<string>`count(*)` }).from(schema.media))[0].total
				)
			};
			for (const table of ['users', 'sessions', 'items', 'media'] as const) {
				console.log(`${table}: source=${counts[table]} target=${copied[table]}`);
			}
			if (
				(Object.keys(counts) as (keyof typeof counts)[]).some(
					(table) => copied[table] !== counts[table]
				)
			)
				throw new CopyError('Source and target counts differ; refusing partial copy');
		});
		console.log('Copy committed.');
	} finally {
		await snapshot?.close();
		source.close();
		await pgClient.end();
	}
}

try {
	await copy();
} catch (error) {
	// Database errors can contain personal values; only our own refusal messages leave the process.
	const message =
		error instanceof CopyError
			? error.message
			: 'Copy failed; the target transaction was rolled back.';
	console.error(message);
	process.exitCode = 1;
}
