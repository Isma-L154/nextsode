import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import type { TestProject } from 'vitest/node';
import { unstable_readConfig } from 'wrangler';

/**
 * The app role's local password, from the Hyperdrive `localConnectionString`.
 *
 * Roles are cluster-wide, so the tests and `npm run db:local` must agree on one
 * password: a different one here would lock the dev server out of the same
 * container after every test run.
 */
function localAppPassword(): string {
	const binding = unstable_readConfig({ config: 'wrangler.jsonc' }).hyperdrive.find(
		({ binding }: { binding: string }) => binding === 'HYPERDRIVE'
	);
	const password = decodeURIComponent(new URL(binding?.localConnectionString ?? '').password);
	// ALTER ROLE cannot bind a password parameter; this allowlist keeps quotes out.
	if (!/^[a-zA-Z0-9_-]+$/.test(password))
		throw new Error('HYPERDRIVE.localConnectionString in wrangler.jsonc needs a simple password');
	return password;
}

export function testDatabaseUrl(): string {
	const url = process.env.TEST_DATABASE_URL;
	if (!url)
		throw new Error(
			'TEST_DATABASE_URL is required: start npm run db:local and export the owner connection from .env'
		);
	return url;
}

export default async function setup({ provide }: TestProject) {
	const appPassword = localAppPassword();
	const client = new Pool({ connectionString: testDatabaseUrl(), max: 1 });
	const admin = drizzle(client);
	const templateUrl = new URL(testDatabaseUrl());
	templateUrl.pathname = '/nextsode_template';
	let template: Pool | undefined;
	try {
		await admin.execute(sql`drop database if exists nextsode_template with (force)`);
		await admin.execute(sql`create database nextsode_template`);
		template = new Pool({ connectionString: templateUrl.toString(), max: 1 });
		const db = drizzle(template);
		await migrate(db, {
			migrationsFolder: './drizzle',
			migrationsSchema: 'nextsode',
			migrationsTable: '__drizzle_migrations'
		});
		await db.execute(sql`alter role nextsode_app login password ${sql.raw(`'${appPassword}'`)}`);
		provide('testAppPassword', appPassword);
	} finally {
		await template?.end();
		await client.end();
	}
}
