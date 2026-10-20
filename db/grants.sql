-- Applied after migrations, as the owner role: bun run db:grants
--
-- Migrations create the tables; this file decides who may touch them. Keep it
-- idempotent — it runs again after every migration.

-- Both runtime roles need to see the schema, and nothing more than that.
GRANT USAGE ON SCHEMA public TO todo_auth, todo_app;

-- The auth role owns the better-auth tables' data and cannot see todos.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "user", session, account, verification TO todo_auth;
REVOKE ALL ON TABLE todos FROM todo_auth;

-- The app role can only touch todos — and only the rows RLS lets through.
-- It needs no grant on "user" despite the foreign key: referential-integrity
-- checks run with the privileges of the constraint's owner, not the caller's.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE todos TO todo_app;
REVOKE ALL ON TABLE "user", session, account, verification FROM todo_app;

-- Belt and braces: neither runtime role may create objects in public.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- The roles are created NOBYPASSRLS by devenv's postgres initialScript (only a
-- superuser can change that, so it is asserted here rather than set here). A
-- role with BYPASSRLS would silently make the policy below decorative.
DO $$
DECLARE offender text;
BEGIN
  SELECT string_agg(rolname, ', ') INTO offender
  FROM pg_roles WHERE rolname IN ('todo_auth', 'todo_app') AND (rolbypassrls OR rolsuper);
  IF offender IS NOT NULL THEN
    RAISE EXCEPTION 'Role(s) % can bypass RLS; the todos policy would not apply to them', offender;
  END IF;
END $$;

-- Not enabled by default: FORCE would subject todo_owner (the table owner) to
-- RLS too. Since no policy grants the owner anything, it would then see zero
-- rows — which breaks drizzle-studio and ad-hoc admin queries. Turn it on if
-- you want the owner connection locked out as well:
--
--   ALTER TABLE todos FORCE ROW LEVEL SECURITY;
