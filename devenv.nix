# The `...` is required: devenv passes extra module arguments (self, inputs,
# config, ...) and a signature without it fails to evaluate. Don't let a
# "remove unused argument" cleanup take it off.
{pkgs, ...}: let
  pgPort = 5432;
  pgHost = "127.0.0.1";
  dbName = "todo";

  # Three roles, three jobs. The split is what makes the RLS story real:
  # - owner: runs migrations, owns every table (and bypasses RLS, as owners do)
  # - auth:  only touches the better-auth tables; cannot see `todos` at all
  # - app:   only touches `todos`, and is subject to RLS (no BYPASSRLS)
  url = role: pass: "postgres://${role}:${pass}@${pgHost}:${toString pgPort}/${dbName}";
in {
  packages = [pkgs.bun pkgs.nodejs_22 pkgs.postgresql_17];

  env = {
    DATABASE_URL_OWNER = url "todo_owner" "owner";
    DATABASE_URL_AUTH = url "todo_auth" "auth";
    DATABASE_URL_APP = url "todo_app" "app";

    # Dev-only secret. Generate a real one for anything deployed:
    #   openssl rand -base64 32
    BETTER_AUTH_SECRET = "dev-only-insecure-secret-change-me-0000000";
    BETTER_AUTH_URL = "http://localhost:3000";
  };

  services.postgres = {
    enable = true;
    package = pkgs.postgresql_17;
    listen_addresses = pgHost;
    port = pgPort;
    initialDatabases = [{name = dbName;}];

    # Runs once, on first cluster start, as the superuser.
    initialScript = ''
      CREATE ROLE todo_owner LOGIN PASSWORD 'owner' CREATEDB;
      CREATE ROLE todo_auth  LOGIN PASSWORD 'auth'  NOBYPASSRLS;
      CREATE ROLE todo_app   LOGIN PASSWORD 'app'   NOBYPASSRLS;
      ALTER DATABASE ${dbName} OWNER TO todo_owner;
    '';
  };

  processes.dev.exec = "bun run dev";

  enterShell = ''
    echo "todo-rls dev shell"
    echo "  devenv up            start postgres (+ dev server via 'processes')"
    echo "  bun run db:setup     migrate + apply grants/RLS wiring"
    echo "  bun run dev          vite dev server on :3000"
  '';
}
