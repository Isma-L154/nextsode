DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'nextsode_backup') THEN
  CREATE ROLE nextsode_backup NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
 ELSIF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'nextsode_backup' AND (rolsuper OR rolcreatedb OR rolcreaterole)) THEN
  RAISE EXCEPTION 'nextsode_backup must be NOSUPERUSER NOCREATEDB NOCREATEROLE';
 END IF;
END; $$;
--> statement-breakpoint
ALTER ROLE nextsode_backup BYPASSRLS NOINHERIT;
--> statement-breakpoint
REVOKE ALL ON SCHEMA nextsode FROM nextsode_backup;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA nextsode FROM nextsode_backup;
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA nextsode FROM nextsode_backup;
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nextsode FROM nextsode_backup;
--> statement-breakpoint
GRANT USAGE ON SCHEMA nextsode TO nextsode_backup;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA nextsode TO nextsode_backup;
--> statement-breakpoint
GRANT SELECT ON ALL SEQUENCES IN SCHEMA nextsode TO nextsode_backup;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA nextsode GRANT SELECT ON TABLES TO nextsode_backup;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA nextsode GRANT SELECT ON SEQUENCES TO nextsode_backup;
