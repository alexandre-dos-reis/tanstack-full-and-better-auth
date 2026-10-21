import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as authSchema from "./schema/auth";
import * as todoSchema from "./schema/todos";

function pool(url: string | undefined, name: string) {
  if (!url) throw new Error(`Missing ${name}. Are you inside the devenv shell?`);
  return new Pool({ connectionString: url, max: 10 });
}

/**
 * Two pools, two roles, two blast radii.
 *
 * `authDb` is the only connection with grants on the better-auth tables.
 * `appDb` is the only connection with grants on `todos`, and it runs as a
 * NOBYPASSRLS role so the policy in src/db/schema/todos.ts actually applies to
 * it. Neither one can read the other's tables, so an injection or a forgotten
 * WHERE clause in todo code cannot reach password hashes or session tokens.
 */
export const authDb = drizzle(pool(process.env.DATABASE_URL_AUTH, "DATABASE_URL_AUTH"), {
  schema: authSchema,
});

const appPool = pool(process.env.DATABASE_URL_APP, "DATABASE_URL_APP");
export const appDb = drizzle(appPool, { schema: todoSchema });

export type AppTx = Parameters<Parameters<typeof appDb.transaction>[0]>[0];

/**
 * Runs `fn` in a transaction with `app.user_id` set to `userId`, which is what
 * the RLS policy on `todos` reads.
 *
 * The transaction is not incidental — it is the isolation boundary.
 * `set_config(..., true)` is transaction-local (the function form of
 * `SET LOCAL`), so the value cannot survive on the pooled connection and reach
 * the next request that borrows it. Setting it session-wide instead would hand
 * one user's id to the next user's query; setting nothing leaves
 * `current_setting('app.user_id', true)` NULL and every row invisible.
 *
 * Every todo query goes through here, and none of them need (or have) a
 * `where userId = ...` clause — Postgres adds it.
 */
async function inUserTransaction<T>(
  userId: string,
  fn: (tx: AppTx) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  return appDb.transaction(async (tx) => {
    // Parameterised, so a hostile user id cannot escape into the SQL.
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  }, config);
}

/** Read-write: use for inserts, updates and deletes. */
export function withUser<T>(userId: string, fn: (tx: AppTx) => Promise<T>): Promise<T> {
  return inUserTransaction(userId, fn);
}

/**
 * Read-only: `BEGIN READ ONLY`, so a write that sneaks into a read handler
 * fails with `read_only_sql_transaction` instead of quietly committing.
 * A safety assertion, not a speed-up — the round trips are the same.
 */
export function readAsUser<T>(userId: string, fn: (tx: AppTx) => Promise<T>): Promise<T> {
  return inUserTransaction(userId, fn, { accessMode: "read only" });
}

export { authSchema, todoSchema };
