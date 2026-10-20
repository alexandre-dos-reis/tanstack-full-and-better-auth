#!/usr/bin/env bash
# Wrapper for db/rls-check.sql: resolves the two seeded user ids with the owner
# connection (the app role has no grant on "user"), then runs the checks as the
# app role.
set -euo pipefail

: "${DATABASE_URL_OWNER:?run this inside the devenv shell}"
: "${DATABASE_URL_APP:?run this inside the devenv shell}"

id_for() {
  psql "$DATABASE_URL_OWNER" -tAc \
    "select id from \"user\" where email = '$1'"
}

alice=$(id_for alice@example.com)
bob=$(id_for bob@example.com)

if [[ -z $alice || -z $bob ]]; then
  echo "Seed fixtures missing — run: bun run db:seed" >&2
  exit 1
fi

exec psql "$DATABASE_URL_APP" \
  -v ON_ERROR_STOP=1 \
  -v alice_id="$alice" \
  -v bob_id="$bob" \
  -f db/rls-check.sql
