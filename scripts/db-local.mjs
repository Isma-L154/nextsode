import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { unstable_readConfig } from 'wrangler';

function localConnections() {
	if (!process.env.DATABASE_URL)
		throw new Error('DATABASE_URL is required: copy .env.example to .env before npm run db:local.');
	let ownerUrl;
	let ownerPassword;
	let ownerUser;
	let database;
	try {
		ownerUrl = new URL(process.env.DATABASE_URL);
		ownerPassword = decodeURIComponent(ownerUrl.password);
		ownerUser = decodeURIComponent(ownerUrl.username);
		database = decodeURIComponent(ownerUrl.pathname.slice(1));
	} catch {
		throw new Error('DATABASE_URL must be a valid local Postgres connection URL.');
	}
	if (
		!['postgres:', 'postgresql:'].includes(ownerUrl.protocol) ||
		!['127.0.0.1', 'localhost'].includes(ownerUrl.hostname) ||
		!ownerPassword ||
		!ownerUser ||
		!database
	)
		throw new Error('DATABASE_URL must specify a local host, owner, password and database.');
	ownerUrl.hostname = '127.0.0.1';

	let appPassword;
	try {
		const config = unstable_readConfig({ config: 'wrangler.jsonc' });
		const binding = config.hyperdrive.find(({ binding }) => binding === 'HYPERDRIVE');
		appPassword = decodeURIComponent(new URL(binding?.localConnectionString).password);
	} catch {
		throw new Error('Set HYPERDRIVE.localConnectionString in wrangler.jsonc to the local app URL.');
	}
	// ALTER ROLE has no password parameter; this allowlist excludes quotes and escapes.
	if (!/^[a-zA-Z0-9_-]+$/.test(appPassword))
		throw new Error(
			'The local app password must use only letters, digits, underscores or hyphens.'
		);
	return { ownerUrl, ownerPassword, ownerUser, database, appPassword };
}

let connections;
try {
	connections = localConnections();
} catch (error) {
	console.error(error.message);
	process.exit(1);
}

const existing = spawnSync(
	'docker',
	['ps', '-a', '--filter', 'name=^/nextsode-pg$', '--format', '{{.Names}}'],
	{ encoding: 'utf8' }
);
if (existing.error || existing.status !== 0) {
	console.error('Docker is unavailable. Start Docker, then run npm run db:local again.');
	process.exit(1);
}
const args =
	existing.stdout.trim() === 'nextsode-pg'
		? ['start', 'nextsode-pg']
		: [
				'run',
				'-d',
				'--name',
				'nextsode-pg',
				'-p',
				`127.0.0.1:${connections.ownerUrl.port || '5432'}:5432`,
				'-e',
				'POSTGRES_PASSWORD',
				'-e',
				'POSTGRES_USER',
				'-e',
				'POSTGRES_DB',
				'supabase/postgres:17.11.0.018'
			];
const result = spawnSync('docker', args, {
	stdio: 'inherit',
	env: {
		...process.env,
		POSTGRES_PASSWORD: connections.ownerPassword,
		POSTGRES_USER: connections.ownerUser,
		POSTGRES_DB: connections.database
	}
});
if (result.error) console.error('Could not start the local Postgres container.');
if (result.error || result.status !== 0) process.exit(1);

// Local credentials never reach migrations or the shared production project.
const client = new Pool({
	connectionString: connections.ownerUrl.toString(),
	max: 1,
	connectionTimeoutMillis: 1000
});
try {
	for (let attempt = 0; ; attempt++) {
		try {
			await client.query('select 1');
			break;
		} catch (error) {
			if (attempt >= 29) throw error;
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}
	await client.query(`do $local$ begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'nextsode_app') then
   create role nextsode_app nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
 END; $local$`);
	await client.query(`alter role nextsode_app login password '${connections.appPassword}'`);
	console.log('Local Postgres is ready. Run npm run db:migrate.');
} catch {
	console.error('Could not initialize the local Postgres role. Check docker logs nextsode-pg.');
	process.exitCode = 1;
} finally {
	await client.end();
}
