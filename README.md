# todo-rls

A single-user-visibility todo app where the "each user sees only their own
todos" rule is enforced by **Postgres row-level security**, not by `where`
clauses in application code. Server-rendered, with optimistic client updates.

```
browser ──► Elysia /api/todos ──► withUser(userId) ──► Postgres
            (session → user.id)    SET LOCAL app.user_id      RLS policy adds
                                   as role todo_app           the user filter
```

Not a single todo query in `src/server/api.ts` mentions `user_id` in its
`WHERE` clause. Postgres puts it there.

## Stack

| Piece | Version | Role here |
| --- | --- | --- |
| devenv | 2.4 | dev shell + Postgres 17 + the three database roles |
| Postgres | 17 | RLS policy, privilege separation |
| drizzle-orm / drizzle-kit | 0.45 / 0.31 | schema, migrations, the RLS policy itself |
| drizzle-zod | 0.8 | every validator derived from the table definition |
| zod | 4 | validation at the API boundary and in the collection |
| TanStack Start | 1.169 | SSR, custom server entry |
| Elysia + Eden | 1.4 | the CRUD handlers, and a typed client for them |
| TanStack Query | 5.104 | per-request cache, SSR dehydration |
| TanStack DB | 0.15 | live queries, optimistic writes, SSR hydration |
| better-auth | 1.7 | email/password auth, sessions |
| @better-auth-ui/core | 1.7 | TanStack Query options for the session, client + server |
| bun | 1.4 | package manager, script runner, production server |

## Quick start

```sh
devenv shell              # or: direnv allow
devenv up -d postgres     # starts Postgres on 127.0.0.1:5432
bun install
bun run db:setup          # migrate, then apply grants + RLS assertions
bun run db:seed           # alice@example.com / bob@example.com, password1234
bun run dev               # http://localhost:3000
```

`devenv up` with no argument starts Postgres *and* the dev server.

Sign in as both seeded users in two browser profiles — they see two different
lists.

## Verifying the isolation

```sh
bun run db:rls-check
```

Connects as `todo_app` (the role the handlers use) and asserts, in SQL:

```
NOTICE:  role todo_app cannot bypass RLS
NOTICE:  PASS  app.user_id unset       -> 0 rows
NOTICE:  PASS  as alice                -> 3 rows
NOTICE:  PASS  as bob                  -> 3 rows
NOTICE:  PASS  bob selecting alice     -> 0 rows
NOTICE:  PASS  bob updating alice      -> 0 rows
NOTICE:  PASS  bob deleting alice      -> 0 rows
NOTICE:  PASS  bob inserting as alice  -> rejected by WITH CHECK
NOTICE:  PASS  bob reassigning to alice-> rejected by WITH CHECK
NOTICE:  PASS  todo_app reading "user" -> permission denied
```

It exits non-zero if any of those stops being true.

## How the isolation works

**Three roles, three jobs** (created in `devenv.nix`, granted in `db/grants.sql`):

| Role | Owns / may touch | RLS |
| --- | --- | --- |
| `todo_owner` | owns every table; runs migrations | bypasses (table owner) |
| `todo_auth` | `user`, `session`, `account`, `verification` | n/a — no grants on `todos` |
| `todo_app` | `todos` only | **enforced** |

`src/db/index.ts` opens one pool per runtime role, so the connection serving
todo CRUD has no grant on the auth tables, and vice versa. A SQL injection in
todo code cannot reach a password hash.

**The policy** (`src/db/schema/todos.ts`, emitted into the migration by
drizzle-kit):

```sql
CREATE POLICY "todos_owner_only" ON "todos" AS PERMISSIVE FOR ALL TO "todo_app"
  USING      ("todos"."user_id" = current_setting('app.user_id', true))
  WITH CHECK ("todos"."user_id" = current_setting('app.user_id', true));
```

`USING` scopes reads, updates and deletes; `WITH CHECK` scopes writes — without
it a user could insert or re-parent a row into someone else's list.

**Fail-closed.** `current_setting(..., true)` returns `NULL` when the GUC is
unset, and `user_id = NULL` is never true. A handler that forgets to go through
`withUser()` sees *zero* rows, not everyone's.

**Request scoping.** `withUser()` wraps each query in a transaction and sets
`app.user_id` with `set_config(..., true)` — transaction-local, so it cannot
leak to the next request that borrows the same pooled connection.

## Transactions

`withUser()` *is* the transaction helper — it opens one, sets `app.user_id` in
it, and hands you the `tx`:

```ts
export async function withUser<T>(userId: string, fn: (tx: AppTx) => Promise<T>) {
  return appDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`)
    return fn(tx)
  })
}
```

Everything you run on `tx` is in that transaction, and drizzle rolls back on any
throw and rethrows — so an Elysia `status(404, ...)` thrown mid-batch both aborts
the writes and becomes the response.

**Reads are transactional too**, and have to be: `set_config(..., true)` is
transaction-local, so there is no way to scope the GUC to one request without
one. Setting it session-wide instead would leave one user's id on the pooled
connection for whoever borrows it next — the classic RLS-with-a-pool leak.
Setting nothing leaves `current_setting('app.user_id', true)` NULL and every row
invisible. So a list read is four round trips (`begin`, `set_config`, `select`,
`commit`) rather than one; that is the price of the GUC, not of the transaction
itself (Postgres wraps every standalone statement in an implicit one anyway).

Read paths use `readAsUser()`, which is the same helper with
`accessMode: 'read only'` — so `BEGIN READ ONLY`, and a write that sneaks into a
read handler fails with SQLSTATE `25006` instead of quietly committing. It is a
safety assertion, not a speed-up.

The thing that is easy to get wrong is scope. One `withUser` per *row* means a
five-row mutation is five transactions that can half-fail. So the collection's
write handlers don't call the single-row routes; they post the whole transaction
to one endpoint:

```
POST /api/todos/batch   { insert?: [...], update?: [{id, ...}], delete?: [id] }
```

which runs every statement inside a single `withUser`. One optimistic
transaction on the client maps to one transaction in Postgres, however many rows
it carries. `collection.insert([a, b, c])` and
`collection.delete([id1, id2])` (the "Clear completed" button) are the cases
this matters for.

RLS and the transaction compose, which gives a nice property: a batch that
touches even one row you don't own fails the ownership check, 404s, and leaves
*nothing* behind — not the rows you did own.

The single-row `POST/PATCH/DELETE /api/todos/:id` routes are still there for
external clients; each is its own transaction.

## How SSR works

`getRouter()` (`src/router.tsx`) runs once per SSR request and once in the
browser, so the `QueryClient`, the `DbClient` and the collections are all
request-scoped. That is the part that makes TanStack DB safe for per-user data:
nothing materialized there outlives the request, so one user's rows can never
be served out of another's cache.

- `@tanstack/react-router-ssr-query` dehydrates the QueryClient into the HTML.
- `@tanstack/react-router-with-db` (`routerWithDbClient`) adds the `DbClient` to
  router context, wraps the app in `DbProvider`, dehydrates critical collection
  state and streams queries discovered later in the render.
- Collections are built by `createCollections(queryClient)` rather than as
  module-level singletons, because a query collection needs *this request's*
  QueryClient. The `DbClient` is also constructed with `{ queryClient }`, which
  first-party adapters read via `client.getDependency('queryClient')`.
- `/todos` awaits `dbClient.collection(collections.todos).preload()` in its
  loader, which puts the rows in the critical payload — the HTML arrives with
  the list rendered. Remove that and the `<Suspense>` boundary around
  `useLiveSuspenseQuery` streams the result instead.

Elysia is mounted in `src/server.ts`, Start's custom server entry: `/api/**`
goes to Elysia, everything else to the Start handler.

Writes go through the collection (`insert` / `update` / `delete`), which applies
them optimistically and then calls the matching Eden client method in
`onInsert` / `onUpdate` / `onDelete`; a rejected request rolls the optimistic
state back. Todo ids are generated client-side so the optimistic row and the
stored row share a key.

## Layout

```
devenv.nix              Postgres 17, the three roles, env vars
drizzle.config.ts       entities.roles: false — devenv owns role creation
db/grants.sql           who may touch what; asserts NOBYPASSRLS
db/rls-check.sql        self-asserting isolation proof
db/seed.ts              two users via better-auth, todos via the RLS role
src/db/schema/auth.ts   generated: bun run auth:generate
src/db/schema/todos.ts  table + pgPolicy (the RLS policy lives here)
src/db/index.ts         two pools (auth/app) + withUser()
src/db/collections.ts   TanStack DB collection, per-request
src/lib/validators.ts   all zod schemas, derived from drizzle
src/lib/auth.ts         better-auth + drizzle adapter
src/server/api.ts       Elysia CRUD handlers
src/server/client.ts    Eden client: fetch in the browser, in-process on SSR
src/server.ts           Start server entry; mounts Elysia at /api
src/router.tsx          per-request QueryClient + DbClient + collections
scripts/serve.ts        production server (bun run build && bun run start)
```

## Notes and gotchas

- **The Eden client has two transports.** In the browser it is ordinary `fetch`.
  During SSR it hands the `Request` straight to the Elysia app in-process and
  forwards the incoming `cookie` header — no loopback HTTP, and better-auth
  resolves the same session. Both server-only imports are dynamic, inside
  `createIsomorphicFn().server()`, so the Start plugin strips the pg/drizzle
  graph from the client bundle. (Verified: no `drizzle-orm`, `pg`, `elysia` or
  `DATABASE_URL` strings in `dist/client`.)
- **Eden revives dates.** The treaty client turns ISO-8601 strings back into
  `Date`, so `Todo.createdAt` is a `Date` on both sides and
  `createSelectSchema(todos)` is the right contract as-is. Plain HTTP clients
  still see ISO strings.
- **`@better-auth/cli` is deliberately not a devDependency.** Its own
  `@better-auth/core` pin (1.4.x) gets hoisted over the one `better-auth` 1.7.x
  needs, and the production bundle then fails with
  `Export named 'APIError' not found`. `bun run auth:generate` uses `bunx`
  instead.
- **The session query comes from `@better-auth-ui/core`, not hand-rolled.**
  `sessionOptions(authClient)` in the browser and `sessionOptionsServer(auth,
  { headers })` on the server share one query key (`['auth', 'getSession']`), so
  what SSR resolves hydrates straight into the client cache. The server half
  calls `auth.api.getSession` **in process** — no HTTP hop and no cookie
  forwarding to get wrong — which is why this project has no `/api/me` endpoint
  of its own. `src/lib/session.ts` picks the half with `createIsomorphicFn`.
  Only `@better-auth-ui/core` is installed; `@better-auth-ui/react` would drag
  in Tailwind and react-email peers for UI components we don't use.
- **The session options set `staleTime: 0`** on purpose, overriding the
  router's global 30s default. An auth guard that trusts a cached answer is
  exactly how you get bounced back to `/login` right after signing in.
  better-auth's `session.cookieCache` keeps the call cheap.
- **Collections are keyed per user, not just per request.** Within one
  DbClient, descriptors sharing an `id` resolve to the same collection, so a
  static `id: 'todos'` hands a newly signed-in user the previous user's rows
  after a client-side sign-out/sign-in — no reload involved to clear it. The
  user id goes in both the collection `id` and the `queryKey`
  (`collections.todosFor(user.id)`), so a different user is a different
  collection by construction. Without this, client-side auth navigation is
  unsafe and the only fix is a full page reload.
- **Sign-in/sign-out drop the cached session, then navigate normally.**
  `queryClient.query()` honours `staleTime`, so the "signed out" session the
  login guard just cached would make `/todos` bounce straight back — it looked
  intermittent because it depended on whether 60s had elapsed. `removeQueries`
  on the session key fixes it for either read API (`ensureQueryData` returns
  cached data even when stale; only removal forces a refetch).
- **The collection descriptor can't live in route context.** `beforeLoad`'s
  return is dehydrated for SSR and a descriptor carries a factory function, so
  it fails `ValidateSerializableMapped`. Derive it from
  `collections.todosFor(user.id)` at each use site instead; `todosFor` memoizes,
  so the object stays stable for the live query's identity.
- **Mutation handlers write through instead of refetching.** Each returns
  `{ refetch: false }` after `collection.utils.writeInsert/writeUpdate/
  writeDelete`. Return nothing and the query collection re-runs `queryFn` after
  every mutation, and warns that the auto-refetch goes away in TanStack DB v1.0.
  Writing the server's own row into synced state avoids the extra round trip and
  still picks up server-generated columns like `updatedAt`.
- **`node_modules/.bin/tsgo` is a symlink to `tsc`,** created by the
  `postinstall` script. TypeScript 7 is the native (Go) compiler and its package
  ships the language server under the name `tsc` (`tsc --lsp --stdio`), but
  editor configs — nvim-lspconfig's `tsgo`, among others — still look for a
  `tsgo` binary. The symlink gives them the name they expect while keeping one
  compiler version for both the editor and `bun run typecheck`. Delete it and
  TypeScript silently stops working in the editor while the CLI stays fine.
- **No `baseUrl` in `tsconfig.json`.** TypeScript 7 removed it, and a
  config-level error like that takes down the editor's whole TS program — every
  file loses IntelliSense at once, even though individual files are fine.
  `paths` entries resolve relative to the tsconfig now. If IntelliSense dies
  project-wide, run `bunx tsc --noEmit` and read the first line.
- **`devenv.nix` must keep the `...` in its argument list.** devenv passes extra
  module arguments (`self`, `inputs`, …); trimming the signature down to
  `{pkgs}:` — e.g. as part of removing genuinely unused `lib`/`config` args —
  makes evaluation fail with `called with unexpected argument 'self'`.
- **`devenv test` is not wired up.** devenv 2.4 silently ignores the older
  `enterTest` option, and a `tasks."devenv:enterTest"` replacement couldn't
  reach Postgres under the test runner's process orchestration. Use
  `bun run typecheck`, `bun run db:rls-check` and `bun run build` instead.
- **The `~/` alias is declared twice**, in `tsconfig.json` and in
  `vite.config.ts` — Vite's dev module runner does not read tsconfig paths.
- **`FORCE ROW LEVEL SECURITY` is left off.** It would subject `todo_owner` to
  RLS too, and since no policy grants the owner anything it would then see zero
  rows — breaking `db:studio` and ad-hoc admin queries. `db/grants.sql` has the
  one-liner if you want it.

## Before deploying this

- Replace `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and the three
  placeholder role passwords; devenv's Postgres trusts local connections, a real
  cluster must not.
- Set `BETTER_AUTH_URL` to the real origin.
- Wire up a mail transport and turn on
  `emailAndPassword.requireEmailVerification` in `src/lib/auth.ts`.
- `bun run db:setup` applies grants after every migration — keep it in the
  deploy step, or new tables will have no grants at all.
