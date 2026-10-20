-- Self-asserting proof that per-user isolation lives in Postgres, not in the
-- query code. Run it with:  bun run db:rls-check
--
-- Connects as `todo_app` — the role the HTTP handlers use — and expects the
-- `bun run db:seed` fixtures (alice and bob, three todos each). Every check
-- RAISEs on failure, so a regression exits non-zero instead of printing a wall
-- of numbers nobody reads.
\set ON_ERROR_STOP on
\pset pager off

-- The app role has no grant on "user", so the two ids are resolved by the
-- wrapper script and passed in. Stash them in GUCs: psql does not interpolate
-- :'vars' inside a dollar-quoted body.
select set_config('check.alice', :'alice_id', false) as _alice,
       set_config('check.bob', :'bob_id', false) as _bob \gset

BEGIN;

DO $$
DECLARE
  alice text := current_setting('check.alice');
  bob   text := current_setting('check.bob');
  n     bigint;
BEGIN
  IF (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'FAIL  %  can bypass RLS; this check would prove nothing', current_user;
  END IF;
  RAISE NOTICE 'role % cannot bypass RLS', current_user;

  -- 1. Fail-closed: a handler that forgets to set app.user_id sees nothing,
  --    rather than seeing everything.
  SELECT count(*) INTO n FROM todos;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL  app.user_id unset leaked % rows', n;
  END IF;
  RAISE NOTICE 'PASS  app.user_id unset       -> 0 rows';

  -- 2. Each user sees exactly their own rows. Note: no WHERE clause.
  PERFORM set_config('app.user_id', alice, true);
  SELECT count(*) INTO n FROM todos;
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL  alice saw % rows, expected 3', n; END IF;
  RAISE NOTICE 'PASS  as alice                -> % rows', n;

  PERFORM set_config('app.user_id', bob, true);
  SELECT count(*) INTO n FROM todos;
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL  bob saw % rows, expected 3', n; END IF;
  RAISE NOTICE 'PASS  as bob                  -> % rows', n;

  -- 3. Asking for someone else's rows by id does not help.
  SELECT count(*) INTO n FROM todos WHERE user_id = alice;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL  bob read % of alice''s rows', n; END IF;
  RAISE NOTICE 'PASS  bob selecting alice     -> 0 rows';

  -- 4. Neither does updating or deleting them: USING hides them from writes too.
  UPDATE todos SET title = 'hijacked' WHERE user_id = alice;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL  bob updated % of alice''s rows', n; END IF;
  RAISE NOTICE 'PASS  bob updating alice      -> 0 rows';

  DELETE FROM todos WHERE user_id = alice;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL  bob deleted % of alice''s rows', n; END IF;
  RAISE NOTICE 'PASS  bob deleting alice      -> 0 rows';

  -- 5. WITH CHECK stops bob from planting a row in alice's list.
  BEGIN
    INSERT INTO todos (user_id, title) VALUES (alice, 'planted by bob');
    RAISE EXCEPTION 'FAIL  bob inserted a row owned by alice';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS  bob inserting as alice  -> rejected by WITH CHECK';
  END;

  -- 6. And cannot reassign one of their own rows to her either.
  BEGIN
    UPDATE todos SET user_id = alice WHERE user_id = bob;
    RAISE EXCEPTION 'FAIL  bob reassigned his row to alice';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS  bob reassigning to alice-> rejected by WITH CHECK';
  END;

  -- 7. The auth tables are out of reach entirely: separate role, no grants.
  BEGIN
    EXECUTE 'SELECT count(*) FROM "user"';
    RAISE EXCEPTION 'FAIL  todo_app can read the user table';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS  todo_app reading "user" -> permission denied';
  END;

  RAISE NOTICE 'all checks passed';
END $$;

-- Nothing above is committed: the mutating checks ran inside this transaction
-- and the only ones that "succeeded" were no-ops anyway.
ROLLBACK;
\echo 'rls-check: all checks passed'
