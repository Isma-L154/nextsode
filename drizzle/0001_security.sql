DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'nextsode_app') THEN
  CREATE ROLE nextsode_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
 ELSIF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'nextsode_app' AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)) THEN
  RAISE EXCEPTION 'nextsode_app must be NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE';
 END IF;
END; $$;
--> statement-breakpoint
CREATE FUNCTION nextsode.current_user_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT nullif(pg_catalog.current_setting('nextsode.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION nextsode.set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$ BEGIN NEW.updated_at = pg_catalog.now(); RETURN NEW; END; $$;
--> statement-breakpoint
CREATE TRIGGER app_user_updated_at BEFORE UPDATE ON nextsode.app_user
FOR EACH ROW EXECUTE FUNCTION nextsode.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER media_updated_at BEFORE UPDATE ON nextsode.media
FOR EACH ROW EXECUTE FUNCTION nextsode.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER watchlist_item_updated_at BEFORE UPDATE ON nextsode.watchlist_item
FOR EACH ROW EXECUTE FUNCTION nextsode.set_updated_at();
--> statement-breakpoint
CREATE FUNCTION nextsode.find_session(p_session_id text)
RETURNS TABLE (user_id uuid, name text, email text, avatar_url text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
 SELECT u.id, u.name, u.email, u.avatar_url, s.expires_at
 FROM nextsode.session s JOIN nextsode.app_user u ON u.id = s.user_id
 WHERE s.id = p_session_id AND p_session_id <> ''
$$;
--> statement-breakpoint
CREATE FUNCTION nextsode.sign_in_google(p_google_id text, p_email text, p_name text, p_avatar_url text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
 INSERT INTO nextsode.app_user (google_id, email, name, avatar_url)
 VALUES (p_google_id, p_email, p_name, p_avatar_url)
 ON CONFLICT (google_id) DO UPDATE
 SET email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
 RETURNING id
$$;
--> statement-breakpoint
CREATE FUNCTION nextsode.shared_list(p_token text)
RETURNS TABLE (
 owner_name text, scope text, to_watch_count bigint, watched_count bigint,
 tmdb_id integer, media_type text, title text, poster_path text, release_date date,
 vote_average real, watched boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
 WITH owner AS (
  SELECT u.id,
   u.name AS display_name, u.share_scope AS scope
  FROM nextsode.app_user u
  WHERE u.share_token = p_token AND p_token <> '' AND u.share_scope IS NOT NULL
 ), counts AS (
  SELECT count(*) FILTER (WHERE NOT w.watched) AS to_watch_count,
   count(*) FILTER (WHERE w.watched) AS watched_count
  FROM nextsode.watchlist_item w JOIN owner o ON o.id = w.user_id
 )
 SELECT o.display_name, o.scope, c.to_watch_count, c.watched_count,
  m.tmdb_id, m.media_type, m.title, m.poster_path, m.release_date, m.vote_average, w.watched
 FROM owner o CROSS JOIN counts c
 LEFT JOIN nextsode.watchlist_item w ON w.user_id = o.id
  AND (o.scope = 'both' OR (o.scope = 'watched' AND w.watched) OR (o.scope = 'toWatch' AND NOT w.watched))
 LEFT JOIN nextsode.media m ON m.id = w.media_id
 ORDER BY w.added_at DESC
$$;
--> statement-breakpoint
CREATE FUNCTION nextsode.calendar_entries(p_token text)
RETURNS TABLE (
 tmdb_id integer, title text, media_type text, release_date date,
 next_season_number smallint, next_season_air_date date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
 SELECT m.tmdb_id, m.title, m.media_type, m.release_date, m.next_season_number, m.next_season_air_date
 FROM nextsode.app_user u
 LEFT JOIN nextsode.watchlist_item w ON w.user_id = u.id
 LEFT JOIN nextsode.media m ON m.id = w.media_id
 WHERE u.calendar_token = p_token AND p_token <> ''
$$;
--> statement-breakpoint
ALTER FUNCTION nextsode.current_user_id() OWNER TO postgres;
ALTER FUNCTION nextsode.set_updated_at() OWNER TO postgres;
ALTER FUNCTION nextsode.find_session(text) OWNER TO postgres;
ALTER FUNCTION nextsode.sign_in_google(text, text, text, text) OWNER TO postgres;
ALTER FUNCTION nextsode.shared_list(text) OWNER TO postgres;
ALTER FUNCTION nextsode.calendar_entries(text) OWNER TO postgres;
--> statement-breakpoint
REVOKE ALL ON SCHEMA nextsode FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA nextsode FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nextsode FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE blocked_role text;
BEGIN
 FOREACH blocked_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = blocked_role) THEN
   EXECUTE pg_catalog.format('REVOKE ALL ON SCHEMA nextsode FROM %I', blocked_role);
   EXECUTE pg_catalog.format('REVOKE ALL ON ALL TABLES IN SCHEMA nextsode FROM %I', blocked_role);
   EXECUTE pg_catalog.format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nextsode FROM %I', blocked_role);
  END IF;
 END LOOP;
END; $$;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA nextsode FROM nextsode_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nextsode FROM nextsode_app;
GRANT USAGE ON SCHEMA nextsode TO nextsode_app;
GRANT SELECT, UPDATE, DELETE ON nextsode.app_user TO nextsode_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON nextsode.session, nextsode.watchlist_item TO nextsode_app;
GRANT SELECT, INSERT, UPDATE ON nextsode.media TO nextsode_app;
GRANT EXECUTE ON FUNCTION nextsode.current_user_id(), nextsode.find_session(text),
 nextsode.sign_in_google(text, text, text, text), nextsode.shared_list(text), nextsode.calendar_entries(text) TO nextsode_app;

--> statement-breakpoint
CREATE POLICY app_user_select_own ON nextsode.app_user
FOR SELECT TO nextsode_app
USING (id = (select nextsode.current_user_id()));

--> statement-breakpoint
CREATE POLICY app_user_update_own ON nextsode.app_user
FOR UPDATE TO nextsode_app
USING (id = (select nextsode.current_user_id()))
WITH CHECK (id = (select nextsode.current_user_id()));

--> statement-breakpoint
CREATE POLICY app_user_delete_own ON nextsode.app_user
FOR DELETE TO nextsode_app
USING (id = (select nextsode.current_user_id()));

--> statement-breakpoint
CREATE POLICY session_select_own ON nextsode.session
FOR SELECT TO nextsode_app
USING (user_id = (select nextsode.current_user_id()));

--> statement-breakpoint
CREATE POLICY session_insert_own ON nextsode.session
FOR INSERT TO nextsode_app
WITH CHECK (user_id = (select nextsode.current_user_id()));

--> statement-breakpoint
CREATE POLICY session_update_own ON nextsode.session
FOR UPDATE TO nextsode_app
USING (user_id = (select nextsode.current_user_id()))
WITH CHECK (user_id = (select nextsode.current_user_id()));

--> statement-breakpoint
CREATE POLICY session_delete_own ON nextsode.session
FOR DELETE TO nextsode_app
USING (user_id = (select nextsode.current_user_id()));

--> statement-breakpoint
CREATE POLICY watchlist_item_select_own ON nextsode.watchlist_item
FOR SELECT TO nextsode_app
USING (user_id = (select nextsode.current_user_id()));

--> statement-breakpoint
CREATE POLICY watchlist_item_insert_own ON nextsode.watchlist_item
FOR INSERT TO nextsode_app
WITH CHECK (user_id = (select nextsode.current_user_id()));

--> statement-breakpoint
CREATE POLICY watchlist_item_update_own ON nextsode.watchlist_item
FOR UPDATE TO nextsode_app
USING (user_id = (select nextsode.current_user_id()))
WITH CHECK (user_id = (select nextsode.current_user_id()));

--> statement-breakpoint
CREATE POLICY watchlist_item_delete_own ON nextsode.watchlist_item
FOR DELETE TO nextsode_app
USING (user_id = (select nextsode.current_user_id()));

--> statement-breakpoint
CREATE POLICY media_select_signed_in ON nextsode.media
FOR SELECT TO nextsode_app
USING ((select nextsode.current_user_id()) is not null);

--> statement-breakpoint
CREATE POLICY media_insert_signed_in ON nextsode.media
FOR INSERT TO nextsode_app
WITH CHECK ((select nextsode.current_user_id()) is not null);

--> statement-breakpoint
CREATE POLICY media_update_signed_in ON nextsode.media
FOR UPDATE TO nextsode_app
USING ((select nextsode.current_user_id()) is not null)
WITH CHECK ((select nextsode.current_user_id()) is not null);
