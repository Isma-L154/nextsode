import { env } from 'cloudflare:workers';

/**
 * Read from `cloudflare:workers`, not `event.platform`: under `vite dev` the
 * adapter serves bindings only through that module.
 */
export function hyperdriveConnectionString(): string {
	return env.HYPERDRIVE.connectionString;
}
