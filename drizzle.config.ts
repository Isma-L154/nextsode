import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (schema owner connection for migrations)');

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	dialect: 'postgresql',
	schemaFilter: ['nextsode'],
	migrations: { schema: 'nextsode', table: '__drizzle_migrations' },
	out: './drizzle',
	dbCredentials: { url },
	verbose: true,
	strict: true
});
