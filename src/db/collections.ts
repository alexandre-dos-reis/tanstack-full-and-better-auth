import { queryCollectionOptions } from "@tanstack/query-db-collection";
import type { QueryClient } from "@tanstack/react-query";
import { collectionOptions } from "@tanstack/react-db";
import { todoSchema } from "~/lib/validators";
import { apiClient, unwrap } from "~/server/client";

/**
 * Collections are built per request, and keyed per user.
 *
 * Two separate scoping rules, both load-bearing:
 *
 * 1. Per request. A query collection needs a QueryClient, and under SSR that
 *    has to be the per-request one — a module-level singleton would leak one
 *    user's todos into the next request's cache. `getRouter()` calls this once
 *    per request on the server and once in the browser.
 *    (`queryCollectionOptions` also resolves `queryClient` from the DbClient's
 *    dependencies when one is registered there, which is why src/router.tsx
 *    passes it to `new DbClient({...})` as well.)
 *
 * 2. Per user. Within one DbClient, descriptors sharing an `id` resolve to the
 *    same collection, so a static `id: 'todos'` would hand a signed-in user the
 *    previous user's rows after a client-side sign-out/sign-in — no reload
 *    involved to clear it. The user id belongs in both the collection `id` and
 *    the `queryKey`; then a different user is a different collection and a
 *    different cache entry, by construction.
 *
 * Descriptors are memoized per user so repeated navigations reuse one object.
 */
export const todosCollection = collectionOptions("todos", (dbClient) =>
  queryCollectionOptions({
    id: `todos`,
    queryKey: ["todos"],
    queryClient: dbClient.requireDependency<QueryClient>("queryClient"),
    schema: todoSchema,
    getKey: (todo) => todo.id,
    queryFn: async () => {
      const client = await apiClient();
      return unwrap(await client.api.todos.get());
    },

    // Write path. Each handler posts the whole transaction to
    // /api/todos/batch in one request, which the server runs inside one
    // Postgres transaction — so a 5-row insert is atomic, not 5 independent
    // writes that can half-fail.
    //
    // TanStack DB has already applied the mutations optimistically and
    // rolls them back if we throw. Each handler then feeds the server's own
    // rows into synced state via `writeInsert`/`writeUpdate`/`writeDelete`
    // and returns `{ refetch: false }`: returning nothing instead re-runs
    // `queryFn` after every mutation (and warns that the auto-refetch goes
    // away in v1.0). Writing through is cheaper and just as correct — the
    // response already carries server-generated columns like `updatedAt`.
    onInsert: async ({ transaction, collection }) => {
      const client = await apiClient();
      const { inserted } = unwrap(
        await client.api.todos.batch.post({
          // ids are client-generated, so the optimistic rows and the stored
          // rows share keys — no flicker, no duplicates on reconcile.
          insert: transaction.mutations.map((m) => ({
            id: m.modified.id,
            title: m.modified.title,
          })),
        }),
      );
      await collection.utils.writeInsert(inserted);
      return { refetch: false };
    },

    onUpdate: async ({ transaction, collection }) => {
      const client = await apiClient();
      const { updated } = unwrap(
        await client.api.todos.batch.post({
          update: transaction.mutations.map((m) => {
            const { title, completed } = m.changes;
            return {
              id: m.key,
              ...(title !== undefined && { title }),
              ...(completed !== undefined && { completed }),
            };
          }),
        }),
      );
      await collection.utils.writeUpdate(updated);
      return { refetch: false };
    },

    onDelete: async ({ transaction, collection }) => {
      const client = await apiClient();
      const { deleted } = unwrap(
        await client.api.todos.batch.post({
          delete: transaction.mutations.map((m) => m.key),
        }),
      );
      await collection.utils.writeDelete(deleted.map((row) => row.id));
      return { refetch: false };
    },
  }),
);
