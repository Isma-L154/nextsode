import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDatabase, seedItem, seedUser, type TestDatabase } from '../test-db';
import { media, session, user, watchlistItem } from './schema';
import { withUser } from './user';

let harness: TestDatabase;
const alice = {
	id: '00000000-0000-4000-8000-000000000001',
	name: 'Alice Example',
	email: 'a@test',
	avatarUrl: null
};
const bob = { ...alice, id: '00000000-0000-4000-8000-000000000002', name: 'Bob' };

beforeEach(async () => {
	harness = await createTestDatabase();
	await seedUser(harness.admin, {
		...alice,
		googleId: 'alice',
		shareToken: 'a'.repeat(64),
		shareScope: 'both'
	});
	await seedUser(harness.admin, { ...bob, googleId: 'bob', calendarToken: 'b'.repeat(64) });
	await seedItem(harness.admin, {
		userId: bob.id,
		tmdbId: 1,
		mediaType: 'movie',
		title: 'Bob only'
	});
	await harness.admin
		.insert(session)
		.values({ id: 'b'.repeat(64), userId: bob.id, expiresAt: new Date(Date.now() + 86_400_000) });
});

afterEach(async () => {
	await harness?.close();
});

describe('backup role', () => {
	beforeEach(async () => {
		// Non-superuser creators receive ADMIN but not SET on newly created roles.
		await harness.admin.execute(sql`grant nextsode_backup to current_user with set true`);
	});

	it('bypasses RLS without administrative privileges or object ownership', async () => {
		await harness.admin.transaction(async (tx) => {
			await tx.execute(sql`set local role nextsode_backup`);
			const [role] = (
				await tx.execute(sql`
				select rolbypassrls, rolsuper, rolcreatedb, rolcreaterole, rolinherit
				from pg_catalog.pg_roles where rolname = current_user`)
			).rows;
			expect(role).toEqual({
				rolbypassrls: true,
				rolsuper: false,
				rolcreatedb: false,
				rolcreaterole: false,
				rolinherit: false
			});
			const owned = (
				await tx.execute(sql`
				select c.relname as name from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
				where n.nspname = 'nextsode' and c.relowner = current_user::regrole
				union all select p.proname from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
				where n.nspname = 'nextsode' and p.proowner = current_user::regrole
				union all select t.typname from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace
				where n.nspname = 'nextsode' and t.typowner = current_user::regrole
				union all select nspname from pg_catalog.pg_namespace
				where nspname = 'nextsode' and nspowner = current_user::regrole`)
			).rows;
			expect(owned).toEqual([]);
		});
	});

	it('reads every owner without an identity with row_security off', async () => {
		await seedItem(harness.admin, {
			userId: alice.id,
			tmdbId: 2,
			mediaType: 'movie',
			title: 'Alice only'
		});
		await harness.admin
			.insert(session)
			.values({ id: 'a'.repeat(64), userId: alice.id, expiresAt: new Date() });
		await harness.admin.transaction(async (tx) => {
			await tx.execute(sql`set local role nextsode_backup`);
			await tx.execute(sql`set local row_security = off`);
			const [identity] = (
				await tx.execute(sql`select nullif(current_setting('nextsode.user_id', true), '') as id`)
			).rows;
			expect(identity.id).toBeNull();
			for (const [table, owner] of [
				[user, user.id],
				[session, session.userId],
				[watchlistItem, watchlistItem.userId]
			] as const) {
				expect(await tx.select({ owner }).from(table).orderBy(owner)).toEqual([
					{ owner: alice.id },
					{ owner: bob.id }
				]);
			}
			expect(await tx.select({ title: media.title }).from(media).orderBy(media.tmdbId)).toEqual([
				{ title: 'Bob only' },
				{ title: 'Alice only' }
			]);
			expect(
				(await tx.execute(sql`select * from nextsode.__drizzle_migrations`)).rows.length
			).toBeGreaterThan(0);
			expect(
				(await tx.execute(sql`select last_value from nextsode.__drizzle_migrations_id_seq`)).rows
			).toHaveLength(1);
		});
	});

	it.each(['app_user', 'session', 'watchlist_item', 'media'])(
		'denies all writes to %s',
		async (name) => {
			const table = sql.identifier(name);
			for (const query of [
				sql`insert into nextsode.${table} default values`,
				sql`update nextsode.${table} set id = id`,
				sql`delete from nextsode.${table}`,
				sql`truncate nextsode.${table} cascade`
			]) {
				await expect(
					harness.admin.transaction(async (tx) => {
						await tx.execute(sql`set local role nextsode_backup`);
						await tx.execute(query);
					})
				).rejects.toMatchObject({
					cause: { code: '42501', message: expect.stringContaining('permission denied') }
				});
			}
		}
	);

	it('denies the SECURITY DEFINER functions', async () => {
		for (const query of [
			sql`select * from nextsode.find_session('x')`,
			sql`select nextsode.sign_in_google('x', 'x', 'x', null)`,
			sql`select * from nextsode.shared_list('x')`,
			sql`select * from nextsode.calendar_entries('x')`
		]) {
			await expect(
				harness.admin.transaction(async (tx) => {
					await tx.execute(sql`set local role nextsode_backup`);
					await tx.execute(query);
				})
			).rejects.toMatchObject({
				cause: { code: '42501', message: expect.stringContaining('permission denied') }
			});
		}
	});

	it('reads future tables and sequences through default privileges', async () => {
		await harness.admin.execute(sql`create table nextsode.backup_probe (id serial primary key)`);
		await harness.admin.execute(sql`alter table nextsode.backup_probe enable row level security`);
		await harness.admin.execute(sql`insert into nextsode.backup_probe default values`);
		await harness.admin.transaction(async (tx) => {
			await tx.execute(sql`set local role nextsode_backup`);
			await tx.execute(sql`set local row_security = off`);
			expect((await tx.execute(sql`select * from nextsode.backup_probe`)).rows).toEqual([
				{ id: 1 }
			]);
			expect(
				(await tx.execute(sql`select last_value from nextsode.backup_probe_id_seq`)).rows
			).toEqual([{ last_value: '1' }]);
		});
	});
});

describe('database isolation', () => {
	it('hides other owners and refuses their updates and deletes', async () => {
		await harness.db.transaction(async (tx) => {
			await tx.execute(sql`select set_config('nextsode.user_id', ${alice.id}, true)`);
			for (const [table, owner] of [
				[user, user.id],
				[session, session.userId],
				[watchlistItem, watchlistItem.userId]
			] as const) {
				expect(await tx.select().from(table).where(eq(owner, bob.id))).toEqual([]);
				expect(await tx.delete(table).where(eq(owner, bob.id)).returning()).toEqual([]);
			}
			expect(
				await tx.update(user).set({ name: 'stolen' }).where(eq(user.id, bob.id)).returning()
			).toEqual([]);
			expect(
				await tx
					.update(session)
					.set({ expiresAt: new Date() })
					.where(eq(session.userId, bob.id))
					.returning()
			).toEqual([]);
			expect(
				await tx
					.update(watchlistItem)
					.set({ watched: true })
					.where(eq(watchlistItem.userId, bob.id))
					.returning()
			).toEqual([]);
			// Titles have no owner: authenticated readers deliberately share TMDB data.
			expect(await tx.select().from(media)).toHaveLength(1);
		});
	});

	it('reads nothing and cannot insert without a user', async () => {
		for (const table of [user, session, media, watchlistItem]) {
			expect(await harness.db.select().from(table)).toEqual([]);
		}
		await expect(
			harness.db.insert(user).values({ googleId: 'forged', name: 'F', email: 'f@test' })
		).rejects.toThrow();
		await expect(
			harness.db.insert(media).values({ tmdbId: 2, mediaType: 'movie', title: 'Forged' })
		).rejects.toThrow();
		await expect(
			harness.db
				.insert(session)
				.values({ id: 'c'.repeat(64), userId: alice.id, expiresAt: new Date() })
		).rejects.toThrow();
		const [title] = await harness.admin.select().from(media);
		await expect(
			harness.db.insert(watchlistItem).values({ userId: alice.id, mediaId: title.id })
		).rejects.toThrow();
	});

	it('clears a committed transaction identity on the same connection', async () => {
		// max: 1 in the harness ensures both transactions reuse the connection.
		await withUser(
			alice,
			async (tx) => {
				expect(await tx.select().from(user)).toHaveLength(1);
			},
			harness.db
		);
		await harness.db.transaction(async (tx) => {
			const [row] = (
				await tx.execute<{ id: string | null }>(sql`select nextsode.current_user_id() as id`)
			).rows;
			expect(row.id).toBeNull();
			for (const table of [user, session, media, watchlistItem])
				expect(await tx.select().from(table)).toEqual([]);
		});
	});

	it('uses an unprivileged role that owns no objects', async () => {
		const [role] = (
			await harness.db.execute(
				sql`select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_catalog.pg_roles where rolname = current_user`
			)
		).rows;
		expect(role).toEqual({
			rolsuper: false,
			rolbypassrls: false,
			rolcreatedb: false,
			rolcreaterole: false
		});
		const owned = (
			await harness.admin.execute(sql`
			select c.relname as name from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
			where n.nspname = 'nextsode' and c.relowner = (select oid from pg_catalog.pg_roles where rolname = 'nextsode_app')
			union all select p.proname from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
			where n.nspname = 'nextsode' and p.proowner = (select oid from pg_catalog.pg_roles where rolname = 'nextsode_app')`)
		).rows;
		expect([...owned]).toEqual([]);
	});

	it.each(['anon', 'authenticated'])('denies schema, tables and functions to %s', async (role) => {
		const [schemaAccess] = (
			await harness.admin.execute(
				sql`select pg_catalog.has_schema_privilege(${role}, 'nextsode', 'USAGE') as allowed`
			)
		).rows;
		expect(schemaAccess.allowed).toBe(false);
		const tableAccess = (
			await harness.admin.execute(sql`
			select pg_catalog.has_table_privilege(${role}, c.oid, 'SELECT, INSERT, UPDATE, DELETE') as allowed
			from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
			where n.nspname = 'nextsode' and c.relkind = 'r'`)
		).rows;
		expect(tableAccess.every((row) => !row.allowed)).toBe(true);
		const functionAccess = (
			await harness.admin.execute(sql`
			select pg_catalog.has_function_privilege(${role}, p.oid, 'EXECUTE') as allowed
			from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
			where n.nspname = 'nextsode'`)
		).rows;
		expect(functionAccess).toHaveLength(6);
		expect(functionAccess.every((row) => !row.allowed)).toBe(true);
		const queries = [
			sql`select * from nextsode.app_user`,
			sql`select * from nextsode.session`,
			sql`select * from nextsode.media`,
			sql`select * from nextsode.watchlist_item`,
			sql`select nextsode.current_user_id()`,
			sql`select nextsode.set_updated_at()`,
			sql`select * from nextsode.find_session('')`,
			sql`select nextsode.sign_in_google('x', 'x', 'x', null)`,
			sql`select * from nextsode.shared_list('')`,
			sql`select * from nextsode.calendar_entries('')`
		];
		for (const query of queries) {
			await expect(
				harness.admin.transaction(async (tx) => {
					await tx.execute(sql`set local role ${sql.identifier(role)}`);
					await tx.execute(query);
				})
			).rejects.toMatchObject({
				cause: { code: '42501', message: expect.stringContaining('permission denied') }
			});
		}
	});

	it('prevents reassignment of owned rows to another account', async () => {
		const item = await seedItem(harness.admin, {
			userId: alice.id,
			tmdbId: 2,
			mediaType: 'movie',
			title: 'Alice only'
		});
		await harness.admin
			.insert(session)
			.values({ id: 'a'.repeat(64), userId: alice.id, expiresAt: new Date() });
		for (const table of [session, watchlistItem]) {
			await expect(
				withUser(
					alice,
					async (tx) => {
						await tx.update(table).set({ userId: bob.id }).where(eq(table.userId, alice.id));
					},
					harness.db
				)
			).rejects.toMatchObject({ cause: { code: '42501' } });
		}
		expect(
			(await harness.admin.select().from(watchlistItem).where(eq(watchlistItem.id, item.id)))[0]
				.userId
		).toBe(alice.id);
	});

	it('returns only public share columns and matches tokens exactly', async () => {
		const rows = (
			await harness.db.execute(sql`select * from nextsode.shared_list(${'a'.repeat(64)})`)
		).rows;
		expect(rows).toHaveLength(1);
		expect(Object.keys(rows[0]).sort()).toEqual([
			'media_type',
			'owner_name',
			'poster_path',
			'release_date',
			'scope',
			'title',
			'tmdb_id',
			'to_watch_count',
			'vote_average',
			'watched',
			'watched_count'
		]);
		expect(rows[0].title).toBeNull();
		expect(rows[0].owner_name).toBe(alice.name);
		for (const token of ['', 'unknown', 'b'.repeat(64), 'a'.repeat(64) + ' ']) {
			expect([
				...(await harness.db.execute(sql`select * from nextsode.shared_list(${token})`)).rows
			]).toEqual([]);
		}
	});
});
